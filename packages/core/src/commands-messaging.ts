// Commands for messaging (BLUEPRINT §8.6, §2.6), and the owner's messaging actions beside them. A message to a person
// is a book: campaign.send, campaign.post, message.reply and customer.remind run only as an approved draft, each under
// the approver in one transaction, and the database derives each message's delivery (recorded unless the shop holds a
// live grant, CH1). consent.record is a person's own command; a withdrawal naming a STOP handles it in the same
// transaction. The words are erasable ops.message_text rows whose sha256 the book keeps; every figure in them is a ref
// to a snapshot cell, rendered by code when the message is written (K3), and a run's copy ends with the disclosure line
// (K4). The actions (compose, propose, a test send, test recipients) write ops rows only. Helpers from commands.ts and
// approvals.ts are used only inside a call, so these value imports are safe while commands.ts spreads this list.
import type pg from 'pg';
import { z } from 'zod';
import { proposeDraft } from './approvals.ts';
import { type CommandResult, type Ctx, type Def, one } from './commands.ts';
import { CoreError } from './errors.ts';
import { phoneHmac } from './inbox.ts';
import { REMINDERS } from './outbox.ts';
import { CAMPAIGN_QUERIES } from './queries-campaigns.ts';
import {
  answerRules,
  COUNT_COL,
  type CellRef,
  cellRule,
  formatRef,
  HANDLE,
  idRef,
  type JsonCell,
  parseRef,
  type Rule,
  renderCell,
  resolveRef,
} from './read.ts';
import { type Session, withTx } from './session.ts';
import { mintIn, runReadOnly } from './snapshots.ts';

// ---- copy: the words of a campaign, a post or a reply ---------------------------------------------------------------
// Copy carries its figures as ref tokens to snapshot cells, never as typed digits (K3): the same detector as the agent's
// validator runs on the copy with each token read as a handle, and the figures are rendered from their cells by code
// when the message is written.

const TOKEN = /⟨snap:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}·\d{1,6}·[a-z_][a-z0-9_]{0,62}⟩/g;

// The AI-output disclosure line (MERCHANTS-DESIGN K4, Meta's terms). The one place its words are written: every body
// whose copy a run wrote ends with it, added here, never by a model (gate K4 scans the sources for these words).
export const AI_DISCLOSURE = 'AI की मदद से लिखा · {shop} ने भेजा';

/** The refs a copy cites, in order of first use. */
export function copyRefs(body: string): CellRef[] {
  return [...new Map((body.match(TOKEN) ?? []).map((t) => [t, parseRef(t) as CellRef])).values()];
}

/** The rules a copy breaks on its own: each ref token read as one handle; a typed handle is no ref. */
export function copyRules(body: string): Rule[] {
  const refs = copyRefs(body).map(formatRef);
  const text = body.replace(TOKEN, (t) => `⟦${refs.indexOf(t) + 1}⟧`);
  const typed = (body.match(HANDLE) ?? []).length > 0;
  return [...new Set<Rule>([...(typed ? (['unknown_handle'] as Rule[]) : []), ...answerRules(text)])];
}

/** Whether a copy holds, in the caller's transaction: no rule broken, every ref a stored cell of this shop that may be
 * cited (no id, no planted figure in a name) and, when `allowed` is given, one of those refs. */
async function copyHolds(c: pg.PoolClient, body: string, allowed?: CellRef[]): Promise<boolean> {
  if (copyRules(body).length) return false;
  const may = allowed && new Set(allowed.map(formatRef));
  for (const ref of copyRefs(body)) {
    const cell = await resolveRef(c, ref);
    if (!cell || idRef(ref) || cellRule(ref, cell) || (may && !may.has(formatRef(ref)))) return false;
  }
  return true;
}

/** The words as sent: each ref token replaced by its cell, rendered; words a run wrote (or edited from a run's, `disclose`)
 * end with the disclosure line. */
async function renderCopy(c: pg.PoolClient, body: string, disclose: boolean, shop: string): Promise<string> {
  let out = body;
  for (const ref of copyRefs(body)) {
    const cell = await resolveRef(c, ref);
    if (!cell) throw new CoreError('conflict'); // a cited cell no longer held: never send "Cannot verify"
    out = out.replaceAll(formatRef(ref), renderCell(cell));
  }
  return disclose ? `${out}\n\n${AI_DISCLOSURE.replace('{shop}', shop)}` : out;
}

// ---- the commands ----------------------------------------------------------------------------------------------------

const id = z.guid();
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const instant = z.iso.datetime({ offset: true });
const ref = z.string().refine((s) => parseRef(s) !== null);

const consentRecord = z.strictObject({
  customerId: id,
  channel: z.enum(['whatsapp', 'sms']).default('whatsapp'),
  purpose: z.enum(['marketing', 'service']),
  granted: z.boolean(),
  source: z.enum(['in_person', 'whatsapp_reply', 'in_chat_attested', 'import']),
  evidenceMessageId: id.optional(),
  noticeVersion: z.string().regex(/^[a-z0-9_.-]{1,40}$/).optional(),
  at: instant.optional(),
});
// The audience snapshot the draft cites (its row count), and the copy by id and hash: a copy edited after the proposal
// is another text, so the draft goes stale.
const campaignSend = z.strictObject({ campaignId: id, audienceId: id, copyTextId: id, copySha256: sha });
const campaignPost = z.strictObject({ campaignId: id, copyTextId: id, copySha256: sha });
const messageReply = z.strictObject({ messageId: id, customerId: id, textId: id, textSha256: sha });
// The figure is a ref, a string (a draft's payload holds no number): the customer's current credit.balance cell for
// credit_due, their package's current value_left (package.balance) for package_expiring. paypal_link names the PayPal
// link it carries (linkId) and its figure is that link's own cited cell (a balance, or an invoice's open credit).
const customerRemind = z.strictObject({ customerId: id, template: z.enum(REMINDERS), figure: ref, linkId: id.optional() });

const campaign = z.strictObject({
  name: z.string().trim().min(1).max(80),
  channel: z.enum(['whatsapp', 'instagram']),
  segment: z.enum(['bought_within_days', 'lapsed_regulars', 'package_expiring']),
  segmentDays: z.number().int().min(1).max(365).optional(),
  offerId: id.optional(),
});
export type CampaignInput = z.input<typeof campaign>;

function def<S extends z.ZodType>(input: S, run: (ctx: Ctx, input: z.output<S>) => Promise<CommandResult>, checks?: Def['checks']): Def {
  return { input, run: run as Def['run'], ...(checks ? { checks, draftOnly: true as const } : {}) };
}

// A reminder's words, by its template; {amount} is the cited cell, rendered. paypal_link's words are PAYPAL_TEXT's.
const REMINDER_TEXT: Record<Exclude<(typeof REMINDERS)[number], 'paypal_link'>, string> = {
  credit_due: '{shop}: a reminder that {amount} is due on your account.',
  package_expiring: '{shop}: a reminder that {amount} is left on your package before it lapses.',
};

// A PayPal link's message (D-079), by the link's purpose, in English and Hindi on one line (a WhatsApp template takes
// no new line): {amount} is the link's own cited cell, rendered; {link} is its PayPal sandbox payer page, or in
// recorded mode (no page) PayPal's recorded id, said to be recorded: the words never claim a page PayPal did not make.
export const PAYPAL_TEXT: Readonly<Record<'credit' | 'invoice', string>> = {
  credit: '{shop}: {amount} is due on your account; pay it by PayPal (sandbox): {link} · आपके खाते पर {amount} बाक़ी है; इसी लिंक से PayPal (sandbox) पर चुकाएँ।',
  invoice:
    '{shop}: {amount} is still due on a bill of yours; pay it by PayPal (sandbox): {link} · आपके एक बिल पर {amount} अभी बाक़ी है; इसी लिंक से PayPal (sandbox) पर चुकाएँ।',
};
const RECORDED_LINK = 'PayPal sandbox link {id} (recorded: nothing was sent to PayPal)';

export type MessageLink = { purpose: 'credit' | 'invoice'; paypalId: string; payerUrl: string | null; mode: string };
/**
 * A PayPal link message as its approval writes it, with its slots unfilled: the one place its words are chosen, so the
 * tray shows the very words (`template`; {shop} the shop, {amount} the cited cell, {link} `where`) a person approves.
 */
export function paypalMessage(link: MessageLink): { template: string; where: string } {
  const where = link.mode === 'sandbox' && link.payerUrl ? link.payerUrl : RECORDED_LINK.replace('{id}', link.paypalId);
  return { template: PAYPAL_TEXT[link.purpose], where };
}

type LinkRow = { id: string; customer_id: string; figure: string; purpose: 'credit' | 'invoice'; paypal_id: string; payer_url: string | null; mode: string };
// The link a paypal_link message names, if PayPal has made it (sent) and no payment has closed it: the only link that
// message may carry. Keyed by the link's id, never by its cell (a re-request of a cancelled link may cite the same cell).
const sendableLink = async (c: pg.PoolClient, linkId: string): Promise<LinkRow | undefined> =>
  (
    await c.query<LinkRow>(
      `select l.id::text, l.customer_id::text, l.figure, l.purpose, l.paypal_id, l.payer_url, l.mode from ops.paypal_link l
        where l.id = $1 and l.status = 'sent' and l.paypal_id is not null and l.mode is not null
          and not exists (select 1 from ops.payment_event e where e.tenant_id = l.tenant_id and e.link_id = l.id)`,
      [linkId],
    )
  ).rows[0];

// A link goes to its customer once: a paypal_link message for this link already executed refuses another. Messages for
// one link are decided one at a time (the lock), so two approvals cannot both pass.
const linkMessaged = async (c: pg.PoolClient, linkId: string) => {
  await c.query(`select pg_advisory_xact_lock(hashtextextended('munshi.paypal-msg:' || current_setting('munshi.tenant_id', true) || ':' || $1, 0))`, [linkId]);
  const { rows } = await c.query(
    `select 1 from approval.draft d where d.command = 'customer.remind' and d.status = 'executed'
        and d.payload ->> 'template' = 'paypal_link' and d.payload ->> 'linkId' = $1`,
    [linkId],
  );
  return rows.length > 0;
};

const AUDIENCE = CAMPAIGN_QUERIES[0]?.[1].sql as string;

// The customer's current, unerased contact phone (books.party_contact's latest link in effect).
const currentPhone = async (c: pg.PoolClient, customerId: string) =>
  (
    await c.query<{ phone: string | null; contact_id: string }>(
      `select ct.phone_e164 as phone, ct.id::text as contact_id from books.party_contact p join ops.contact ct on ct.tenant_id = p.tenant_id and ct.id = p.contact_id
        where p.customer_id = $1 and p.effective_from <= now() and ct.erased_at is null
        order by p.effective_from desc, p.created_at desc, p.id desc limit 1`,
      [customerId],
    )
  ).rows[0];

type Copy = {
  status: string;
  channel: string;
  offer_id: string | null;
  name: string;
  copy_text_id: string | null;
  body: string | null;
  author: string;
  run_id: string | null;
  sha: string;
  ai_written: boolean;
};
// `ai_written`: a run once wrote a version of this campaign's copy (BLUEPRINT §8.6): words stored as the run's, by a run
// that minted this campaign's campaign.audience read. Every later version keeps the disclosure line, edited by a person
// or not; it is decided here from that history, never from a form.
const copyOf = async (c: pg.PoolClient, campaignId: string): Promise<Copy | undefined> =>
  (
    await c.query<Copy>(
      `select k.status, k.channel, k.offer_id, k.name, k.copy_text_id::text, t.body, t.author, t.run_id, encode(t.body_sha256, 'hex') as sha,
              exists (select 1 from ops.message_text w join snap.snapshot s on s.tenant_id = w.tenant_id and s.run_id = w.run_id
                       where w.tenant_id = k.tenant_id and w.author = 'run' and s.query_name = 'campaign.audience'
                         and s.params->>'campaign_id' = k.id::text) as ai_written
         from ops.campaign k left join ops.message_text t on t.tenant_id = k.tenant_id and t.id = k.copy_text_id where k.id = $1`,
      [campaignId],
    )
  ).rows[0];
/** Whether a campaign's words go out with the disclosure line: a run's own, or a person's edit of a campaign a run wrote. */
const discloses = (k: Copy) => k.author === 'run' || k.ai_written;

// The rules every campaign draft keeps, at proposal and again at approval: the campaign is proposed on this channel,
// with this copy, unchanged and still holding (refs only, each cited by the draft); its offer, if any, still in effect.
async function campaignHolds(c: pg.PoolClient, p: { campaignId: string; copyTextId: string; copySha256: string }, basedOn: CellRef[], channel: string) {
  const k = await copyOf(c, p.campaignId);
  if (k?.status !== 'proposed' || k.channel !== channel) return ['campaignId'];
  const bad: string[] = [];
  if (k.copy_text_id !== p.copyTextId || k.sha !== p.copySha256 || !k.body || !(await copyHolds(c, k.body, basedOn))) bad.push('copyTextId');
  if (k.offer_id) {
    const { rows } = await c.query(
      `select 1 from books.offer o where o.id = $1 and o.published and o.starts_at <= now() and o.ends_at > now()
          and not exists (select 1 from books.offer_end e where e.tenant_id = o.tenant_id and e.offer_id = o.id)`,
      [k.offer_id],
    );
    if (!rows.length) bad.push('campaignId');
  }
  return bad;
}

// K5: the audience the draft cites is this campaign's, not empty, and the whole set re-read now is the same set of
// customers, not only as many (a recheck of the cited row count alone would pass one who withdrew for one who agreed).
async function audienceHolds(c: pg.PoolClient, p: { campaignId: string; audienceId: string }, basedOn: CellRef[]): Promise<string[]> {
  if (!basedOn.some((r) => r.snapshotId === p.audienceId && r.row === 0 && r.col === COUNT_COL)) return ['audienceId'];
  const stored = await audienceOf(c, p.audienceId, p.campaignId);
  const now = (await runReadOnly(c, AUDIENCE, [p.campaignId])).map((r) => r.customer_id as string);
  return !stored?.length || stored.join() !== now.join() ? ['audienceId'] : [];
}

// The customer ids an audience snapshot holds, if it is this campaign's.
async function audienceOf(c: pg.PoolClient, snapshotId: string, campaignId: string): Promise<string[] | null> {
  const { rows } = await c.query<{ query_name: string; params: { campaign_id?: string }; rows: JsonCell[][] }>(
    'select query_name, params, rows from snap.snapshot where id = $1',
    [snapshotId],
  );
  const s = rows[0];
  if (s?.query_name !== 'campaign.audience' || s.params.campaign_id !== campaignId) return null;
  return s.rows.map((r) => (r[0] as { t: string }).t);
}

// The approved copy rendered once, as a new text of the same author (a run's keeps its run); `disclose` adds the line.
async function renderedText(ctx: Ctx, body: string, author: string, runId: string | null, disclose = author === 'run') {
  const text = await renderCopy(ctx.c, body, disclose, ctx.t.name);
  return insertText(ctx.c, ctx.t.tenantId, text, author, runId);
}

async function insertText(c: pg.PoolClient, tenantId: string, body: string, author: string, runId: string | null) {
  const { rows } = await c.query<{ id: string; body_sha256: Buffer }>(
    `insert into ops.message_text (tenant_id, body, author, run_id, body_sha256) values ($1, $2, $3, $4, '\\x00') returning id, body_sha256`,
    [tenantId, body, author, runId],
  );
  return rows[0] as { id: string; body_sha256: Buffer };
}

// Proposed → approved, once: the row lock makes a second draft of the same campaign wait, then find it approved.
async function approve(c: pg.PoolClient, campaignId: string) {
  const r = await c.query(`update ops.campaign set status = 'approved' where id = $1 and status = 'proposed'`, [campaignId]);
  if (r.rowCount !== 1) throw new CoreError('conflict', { fields: ['campaignId'] });
}

export const MESSAGING_COMMANDS: [string, Def][] = [
  [
    // Consent as given or withdrawn, by the contact the customer is linked to now (b_consent_contact). Evidence is an inbox
    // message from that contact's phone; a withdrawal naming a STOP handles that message here, beside it (inbound_flow).
    'consent.record',
    def(consentRecord, async (ctx, i) => {
      const { c, t } = ctx;
      const contact = await currentPhone(c, i.customerId);
      if (!contact) throw new CoreError('invalid', { fields: ['customerId'] });
      let stop = false;
      if (i.evidenceMessageId) {
        const msg = await one<{ from_address: string | null; opt_out: boolean; status: string }>(
          c,
          'select from_address, opt_out, status from ops.inbound_message where id = $1 and erased_at is null',
          [i.evidenceMessageId],
        );
        if (msg.from_address !== contact.phone) throw new CoreError('invalid', { fields: ['evidenceMessageId'] });
        stop = msg.opt_out && msg.status === 'new' && !i.granted;
      }
      const consent = await one<{ id: string }>(
        c,
        `insert into books.customer_consent (tenant_id, customer_id, contact_id, channel, purpose, granted, source, evidence_rel, evidence_id, notice_version, at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11::timestamptz, now())) returning id`,
        [
          t.tenantId,
          i.customerId,
          contact.contact_id,
          i.channel,
          i.purpose,
          i.granted,
          i.source,
          i.evidenceMessageId ? 'ops.inbound_message' : null,
          i.evidenceMessageId ?? null,
          i.noticeVersion ?? null,
          i.at ?? null, // at ≤ created_at, which is the transaction's now()
        ],
      );
      if (stop) await c.query(`update ops.inbound_message set status = 'handled' where id = $1`, [i.evidenceMessageId]);
      return { consentId: consent.id };
    }),
  ],
  [
    // A WhatsApp campaign: one message per customer of the cited audience (which the checks have just found unchanged),
    // all naming one rendered text.
    'campaign.send',
    def(
      campaignSend,
      async (ctx, i) => {
        const { c, t } = ctx;
        await approve(c, i.campaignId);
        const k = (await copyOf(c, i.campaignId)) as Copy;
        const audience = (await audienceOf(c, i.audienceId, i.campaignId)) as string[];
        const text = await renderedText(ctx, k.body as string, k.author, k.run_id, discloses(k));
        await c.query(
          `insert into books.outbound_message (tenant_id, channel, recipient_kind, recipient_id, text_id, body_sha256, campaign_id)
           select $1, 'whatsapp', 'customer', x::uuid, $2, $3, $4 from unnest($5::text[]) x`,
          [t.tenantId, text.id, text.body_sha256, i.campaignId, audience],
        );
        return { campaignId: i.campaignId, textId: text.id };
      },
      async (c, payload, _refs, basedOn) => {
        const p = payload as z.output<typeof campaignSend>;
        const bad = await campaignHolds(c, p, basedOn, 'whatsapp');
        return bad.includes('campaignId') ? bad : [...bad, ...(await audienceHolds(c, p, basedOn))];
      },
    ),
  ],
  [
    // An Instagram post: one public message naming the campaign. Posted only where the shop's Instagram grant holds.
    'campaign.post',
    def(
      campaignPost,
      async (ctx, i) => {
        const { c, t } = ctx;
        await approve(c, i.campaignId);
        const k = (await copyOf(c, i.campaignId)) as Copy;
        const text = await renderedText(ctx, k.body as string, k.author, k.run_id, discloses(k));
        await c.query(
          `insert into books.outbound_message (tenant_id, channel, recipient_kind, recipient_id, text_id, body_sha256, campaign_id)
           values ($1, 'instagram', 'public', $2, $3, $4, $2)`,
          [t.tenantId, i.campaignId, text.id, text.body_sha256],
        );
        return { campaignId: i.campaignId, textId: text.id };
      },
      (c, payload, _refs, basedOn) => campaignHolds(c, payload as z.output<typeof campaignPost>, basedOn, 'instagram'),
    ),
  ],
  [
    // A reply to an inbox message, to the customer whose phone sent it; the database gives it the 24 hours after it.
    'message.reply',
    def(
      messageReply,
      async (ctx, i) => {
        const { c, t } = ctx;
        const draft = await one<{ body: string; author: string; run_id: string | null }>(c, 'select body, author, run_id from ops.message_text where id = $1', [i.textId]);
        const text = await renderedText(ctx, draft.body, draft.author, draft.run_id);
        await c.query(
          `insert into books.outbound_message (tenant_id, channel, recipient_kind, recipient_id, text_id, body_sha256, reply_to_id)
           values ($1, 'whatsapp', 'customer', $2, $3, $4, $5)`,
          [t.tenantId, i.customerId, text.id, text.body_sha256, i.messageId],
        );
        return { textId: text.id };
      },
      async (c, payload, _refs, basedOn) => {
        const p = payload as z.output<typeof messageReply>;
        const { rows } = await c.query<{ from_address: string | null; body: string | null; sha: string }>(
          `select i.from_address, t.body, encode(t.body_sha256, 'hex') as sha from ops.inbound_message i, ops.message_text t
            where i.id = $1 and i.erased_at is null and t.id = $2`,
          [p.messageId, p.textId],
        );
        const r = rows[0];
        const bad: string[] = [];
        if (!r?.from_address || r.from_address !== (await currentPhone(c, p.customerId))?.phone) bad.push('customerId');
        if (!r?.body || r.sha !== p.textSha256 || !(await copyHolds(c, r.body, basedOn))) bad.push('textId');
        return bad;
      },
    ),
  ],
  [
    // A service reminder from a template, its figure the customer's current balance cell. The database lets it reach the
    // customer only with service consent from their current contact; without it the approval is refused (MS007).
    'customer.remind',
    def(
      customerRemind,
      async (ctx, i) => {
        const { c, t } = ctx;
        const amount = renderCell(await resolveRef(c, i.figure));
        let words: string;
        if (i.template === 'paypal_link') {
          // The very link the draft names, still made and unpaid; else nothing is sent (the checks made it stale first).
          const link = i.linkId ? await sendableLink(c, i.linkId) : undefined;
          if (!link || link.customer_id !== i.customerId || link.figure !== i.figure) throw new CoreError('conflict', { fields: ['linkId'] });
          const m = paypalMessage({ purpose: link.purpose, paypalId: link.paypal_id, payerUrl: link.payer_url, mode: link.mode });
          words = m.template.replaceAll('{shop}', t.name).replaceAll('{amount}', amount).replaceAll('{link}', m.where);
        } else {
          words = REMINDER_TEXT[i.template].replace('{shop}', t.name).replace('{amount}', amount);
        }
        const text = await insertText(c, t.tenantId, words, 'template', null);
        await c.query(
          `insert into books.outbound_message (tenant_id, channel, recipient_kind, recipient_id, template_code, text_id, body_sha256)
           values ($1, 'whatsapp', 'customer', $2, $3, $4, $5)`,
          [t.tenantId, i.customerId, i.template, text.id, text.body_sha256],
        );
        return { textId: text.id };
      },
      async (c, payload, _refs, basedOn) => {
        const p = payload as z.output<typeof customerRemind>;
        const figure = parseRef(p.figure) as CellRef;
        const { rows } = await c.query<{ query_name: string; params: { customer_id?: string } }>('select query_name, params from snap.snapshot where id = $1', [
          figure.snapshotId,
        ]);
        const cited = basedOn.some((r) => formatRef(r) === p.figure) && figure.row === 0;
        // A PayPal link's message: it names a link of this customer that PayPal has made and no payment closed, its
        // figure that link's own cited cell (a balance, or an invoice's open credit), and no message carried it yet.
        if (p.template === 'paypal_link') {
          const link = p.linkId ? await sendableLink(c, p.linkId) : undefined;
          if (!link || link.customer_id !== p.customerId || link.figure !== p.figure || !cited) return ['linkId'];
          return (await linkMessaged(c, link.id)) ? ['linkId'] : [];
        }
        if (p.linkId !== undefined) return ['linkId'];
        if (p.template === 'package_expiring') {
          // The holding's value left, read for this customer's holding (the read's own customer_id cell says whose).
          const owner = await resolveRef(c, { snapshotId: figure.snapshotId, row: 0, col: 'customer_id' });
          const theirs = owner?.kind === 'text' && owner.txt === p.customerId;
          return cited && rows[0]?.query_name === 'package.balance' && figure.col === 'value_left' && theirs ? [] : ['figure'];
        }
        return cited && rows[0]?.query_name === 'credit.balance' && rows[0].params.customer_id === p.customerId && figure.col === 'balance'
          ? []
          : ['figure'];
      },
    ),
  ],
];

// ---- the owner's actions: ops rows only ------------------------------------------------------------------------------

/** A new campaign, composing. */
export async function createCampaign(pool: pg.Pool, session: Session, input: CampaignInput): Promise<string> {
  const r = campaign.safeParse(input);
  if (!r.success) throw new CoreError('invalid', { fields: r.error.issues.map((x) => x.path.join('.') || '(input)') });
  const i = r.data;
  return withTx(pool, { kind: 'member', session }, async (c) => {
    const made = await one<{ id: string }>(
      c,
      `insert into ops.campaign (tenant_id, name, channel, segment, segment_days, offer_id)
       values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5) returning id`,
      [i.name, i.channel, i.segment, i.segmentDays ?? null, i.offerId ?? null],
    );
    return made.id;
  });
}

// Copy is held to the rule before it is stored: refs only, no typed figure, every ref a cell of this shop (K3).
async function storeCopy(c: pg.PoolClient, by: { session: Session; runId?: string }, body: string) {
  if (body.length < 1 || body.length > 4000 || !(await copyHolds(c, body))) throw new CoreError('invalid', { fields: ['body'] });
  return insertText(c, by.session.tenantId, body, by.runId ? 'run' : 'member', by.runId ?? null);
}

/** A campaign's copy, a person's own or their run's (BP-AI-1's copy writer passes its run): stored while composing. */
export async function writeCopy(pool: pg.Pool, by: { session: Session; runId?: string }, campaignId: string, body: string): Promise<string> {
  return withTx(pool, { kind: 'member', session: by.session }, async (c) => {
    const text = await storeCopy(c, by, body);
    const r = await c.query('update ops.campaign set copy_text_id = $2 where id = $1', [campaignId, text.id]);
    if (r.rowCount !== 1) throw new CoreError('not_found');
    return text.id;
  });
}

/** A reply's words, before its message.reply draft names them. */
export async function writeReply(pool: pg.Pool, by: { session: Session; runId?: string }, body: string): Promise<string> {
  return withTx(pool, { kind: 'member', session: by.session }, async (c) => (await storeCopy(c, by, body)).id);
}

/** Proposes the campaign's send (WhatsApp) or post (Instagram): the campaign is locked for review and its audience minted,
 * then the draft cites that audience's row count and every figure of the copy. A refused proposal unlocks it again. */
export async function proposeCampaign(pool: pg.Pool, session: Session, campaignId: string): Promise<string> {
  const draft = await withTx(pool, { kind: 'member', session }, async (c) => {
    const k = await copyOf(c, campaignId);
    if (!k) throw new CoreError('not_found');
    if (k.status !== 'composing' || !k.copy_text_id || !k.body) throw new CoreError('invalid', { fields: ['campaignId'] });
    await c.query(`update ops.campaign set status = 'proposed' where id = $1`, [campaignId]);
    const audience = await mintIn(c, 'campaign.audience', { campaign_id: campaignId });
    const basedOn = [{ snapshotId: audience.id, row: 0, col: COUNT_COL }, ...copyRefs(k.body)];
    const copy = { campaignId, copyTextId: k.copy_text_id, copySha256: k.sha };
    return k.channel === 'whatsapp'
      ? { command: 'campaign.send', payload: { ...copy, audienceId: audience.id }, basedOn }
      : { command: 'campaign.post', payload: copy, basedOn };
  });
  try {
    return await proposeDraft(pool, { session }, draft);
  } catch (err) {
    await withTx(pool, { kind: 'member', session }, (c) => c.query(`update ops.campaign set status = 'composing' where id = $1 and status = 'proposed'`, [campaignId]));
    throw err;
  }
}

/** "Send a test to me": the copy as it would be sent, to the member's own phone only; an ops delivery, no book row. */
export async function sendTest(pool: pg.Pool, session: Session, campaignId: string): Promise<string> {
  return withTx(pool, { kind: 'member', session }, async (c) => {
    const k = await copyOf(c, campaignId);
    if (!k?.body || !(await copyHolds(c, k.body))) throw new CoreError('invalid', { fields: ['campaignId'] });
    const { rows } = await c.query<{ name: string }>('select name from ops.tenant');
    const text = await insertText(c, session.tenantId, await renderCopy(c, k.body, discloses(k), (rows[0] as { name: string }).name), k.author, k.run_id);
    const d = await one<{ id: string }>(
      c,
      `insert into ops.delivery (tenant_id, test_member_id, test_text_id, channel, mode, status, not_after)
       values ($1, $2, $3, 'whatsapp', 'recorded', 'queued', now()) returning id`,
      [session.tenantId, session.memberId, text.id],
    );
    return d.id;
  });
}

/** An owner lists one of the shop's own people (a customer's contact, or a member) as a WhatsApp test recipient, with
 * the route that lets their messages find this shop; the grant's cap and its liveness are the database's rule. */
export async function listTestRecipient(pool: pg.Pool, session: Session, who: { contactId: string } | { memberId: string }, routeKey: Buffer): Promise<string> {
  return withTx(pool, { kind: 'member', session }, async (c) => {
    const { rows } = await c.query<{ phone: string | null }>(
      'contactId' in who
        ? 'select phone_e164 as phone from ops.contact where id = $1 and erased_at is null'
        : 'select phone_e164 as phone from ops.member where id = $1 and active',
      ['contactId' in who ? who.contactId : who.memberId],
    );
    const phone = rows[0]?.phone;
    if (!phone) throw new CoreError('invalid', { fields: ['contactId' in who ? 'contactId' : 'memberId'] });
    const r = await one<{ id: string }>(c, 'insert into ops.channel_recipient (tenant_id, contact_id, member_id) values ($1, $2, $3) returning id', [
      session.tenantId,
      'contactId' in who ? who.contactId : null,
      'memberId' in who ? who.memberId : null,
    ]);
    await c.query('insert into ops.phone_route (phone_hmac, tenant_id, recipient_id) values ($1, $2, $3)', [phoneHmac(routeKey, phone), session.tenantId, r.id]);
    return r.id;
  });
}

