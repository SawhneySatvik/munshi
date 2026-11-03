// PayPal payment links (D-079, platform design §6), in sandbox. Payments are recorded, never processed: PayPal holds and
// moves the money; Munshi asks for a link only as an approved draft's effect, and a paid notification changes no book.
//   1. paypal.request and paypal.cancel (commands-paypal.ts), draft-only: proposed here from the cell the amount is (or
//      the link to close); approved, they change ops.paypal_link and call no PayPal; the jobs role's sweep
//      (jobs-paypal.ts) talks to PayPal afterwards, the approving shop's own links at once (sweepShopPaypal).
//   2. The webhook (apps/web/app/api/webhooks/paypal), its signature verified by PayPal: receivePaypalPaid finds the
//      shop by PayPal's id (ops.paypal_route) and stores one ops.payment_event per PayPal event id, as the public role.
//      No book row, no draft: a webhook has no person.
//   3. A member's own request (a tap, or a run for them from the watch.paypal_unrecorded finding) proposes "record this
//      payment": payment.record by PayPal, its amount and date the paypal.event cells of the stored notification.
//   4. The link reaches the customer as its own approved message (messagePaypalLink): once PayPal has made it, a
//      customer.remind draft with the paypal_link template is proposed and waits, its words in full, for a person's
//      approval; approved, it goes out on WhatsApp through the outbox (recorded until the shop's channel is live).
//      PayPal's own email stays off.
// commands.ts is imported first, so the command registry (which spreads commands-paypal.ts once registered) is whole
// before this file's own imports close the cycle through approvals.ts.
import './commands.ts';
import type pg from 'pg';
import { type Proposer, proposeDraft } from './approvals.ts';
import { debtBusy, LIVE_LINK } from './commands-paypal.ts';
import { COMMANDS } from './commands.ts';
import { CoreError } from './errors.ts';
import { sweepPaypalLinks } from './jobs-paypal.ts';
import { QUERIES } from './queries.ts';
import { type CellRef, formatRef, parseRef } from './read.ts';
import { mayReadIn } from './read-roles.ts';
import { type Session, withTx } from './session.ts';
import { mintIn } from './snapshots.ts';
import { read } from './views-common.ts';
import { capabilitiesOn } from './watchers.ts';

export { wiredPayPal, wirePayPal } from './jobs-paypal.ts';

export const PAYPAL_LABEL = 'PayPal sandbox';
/** How many links a page shows at most, newest first (the page says so when there are more). */
export const PAYPAL_PAGE = 200;

export type PaypalTarget = { customerId: string } | { invoiceId: string };

const textOf = (cell: { kind: string; txt?: string } | undefined) => (cell?.kind === 'text' ? (cell.txt ?? '') : '');

/**
 * A member's own "Send PayPal link": mints the cell the amount is (the customer's current credit.balance, or the
 * invoice's sale's open credit) and proposes paypal.request citing it. Nothing goes to PayPal until a person approves.
 * Proposals for one customer run one at a time (an advisory lock held across the proposal), so a second is refused
 * (conflict) while a link is live or a link draft waits; the draft's own checks hold the same rule at approval.
 */
export async function proposePaypalLink(pool: pg.Pool, by: Proposer, target: PaypalTarget, findingId?: string): Promise<string> {
  // The cell is minted and kept first (the draft's own transaction must see it), then the proposal runs under the lock.
  const draft = await withTx(pool, { kind: 'member', session: by.session }, async (c): Promise<{ payload: Record<string, unknown>; basedOn: CellRef[]; customerId: string }> => {
    if ('customerId' in target) {
      const balance = await mintIn(c, 'credit.balance', { customer_id: target.customerId });
      if (!balance.rows[0]) throw new CoreError('not_found');
      const figure = { snapshotId: balance.id, row: 0, col: 'balance' };
      return { payload: { purpose: 'credit', customerId: target.customerId, figure: formatRef(figure) }, basedOn: [figure, { ...figure, col: 'customer_id' }], customerId: target.customerId };
    }
    const open = await mintIn(c, 'invoice.open_credit', { invoice_id: target.invoiceId });
    const row = open.rows[0];
    const customerId = textOf(row?.customer_id as never);
    if (!row || !customerId) throw new CoreError('invalid', { fields: ['invoiceId'] });
    const cell = (col: string) => ({ snapshotId: open.id, row: 0, col });
    return {
      payload: { purpose: 'invoice', invoiceId: target.invoiceId, customerId, figure: formatRef(cell('open')) },
      basedOn: [cell('open'), cell('sale_reversed'), cell('customer_id')],
      customerId,
    };
  });
  return withTx(pool, { kind: 'member', session: by.session }, async (c) => {
    // Serializes this customer's proposals (a key of its own: the draft's checks take the debt's key in their own
    // transaction, so the two never wait on each other).
    await c.query(`select pg_advisory_xact_lock(hashtextextended('munshi.paypal-propose:' || $1 || ':' || $2, 0))`, [by.session.tenantId, draft.customerId]);
    if (await debtBusy(c, draft.customerId)) throw new CoreError('conflict', { fields: ['customerId'] });
    return proposeDraft(pool, by, { command: 'paypal.request', payload: draft.payload, basedOn: draft.basedOn, payloadRefs: {}, ...(findingId ? { findingId } : {}) });
  });
}

/** "Cancel link": a member proposes paypal.cancel for a live link (a debt settled another way); a person approves it. */
export async function proposePaypalCancel(pool: pg.Pool, by: Proposer, linkId: string): Promise<string> {
  const figure = await withTx(pool, { kind: 'member', session: by.session }, async (c) => {
    const { rows } = await c.query<{ figure: string }>(`select l.figure from ops.paypal_link l where l.id = $1 and l.status in ('queued', 'sent') and ${LIVE_LINK}`, [linkId]);
    return rows[0] ? parseRef(rows[0].figure) : null;
  });
  if (!figure) throw new CoreError('invalid', { fields: ['linkId'] });
  return proposeDraft(pool, by, { command: 'paypal.cancel', payload: { linkId }, basedOn: [figure], payloadRefs: {} });
}

/** A draft's command, read before a decision so what follows it (a PayPal link's sweep and message) is keyed by it. */
export async function draftCommand(pool: pg.Pool, session: Session, draftId: string): Promise<string | null> {
  return withTx(pool, { kind: 'member', session }, async (c) => {
    const { rows } = await c.query<{ command: string }>('select command from approval.draft where id = $1', [draftId]);
    return rows[0]?.command ?? null;
  });
}

/** The link an approved paypal.request made (its draft's id), or null: what the approver's request sends on after. */
export async function linkOfDraft(pool: pg.Pool, session: Session, draftId: string): Promise<string | null> {
  return withTx(pool, { kind: 'member', session }, async (c) => {
    const { rows } = await c.query<{ id: string }>('select id::text from ops.paypal_link where draft_id = $1', [draftId]);
    return rows[0]?.id ?? null;
  });
}

/**
 * What drafting a link's WhatsApp message did: drafted (a customer.remind draft waiting for a person), or why not: one
 * already waits (waiting), one already went (messaged), PayPal has not made the link yet, or the customer cannot be
 * reached on WhatsApp.
 */
export type LinkMessage = 'drafted' | 'waiting' | 'not_made' | 'messaged' | 'messaging_off' | 'no_contact' | 'no_consent';

/**
 * The link reaches its customer (D-079), as its own approved message: once PayPal has made the link (sent, unpaid), the
 * member's request (the link's approver, right after the sweep, or a tap on "Draft the WhatsApp message") proposes a
 * customer.remind draft with the paypal_link template, and nothing more. It waits in the tray with its words in full
 * (paypalMessageWords: the shop, the amount from the link's own balance cell, the PayPal sandbox link) until a person
 * approves it; only that approval writes the message, under the approver, and the database lets it out only on WhatsApp
 * to the customer's current contact with service consent; the outbox delivers it (recorded until the shop's channel is
 * live). PayPal never emails the customer (send_to_recipient stays false). Never called from a watcher or a job.
 */
export async function messagePaypalLink(pool: pg.Pool, session: Session, linkId: string): Promise<{ outcome: LinkMessage; draftId?: string }> {
  // One proposal per link at a time, held across the proposal (a key of its own: the draft's checks take the link's
  // message key in their own transaction, so the two never wait on each other).
  return withTx(pool, { kind: 'member', session }, async (c) => {
    await c.query(`select pg_advisory_xact_lock(hashtextextended('munshi.paypal-msg-propose:' || $1 || ':' || $2, 0))`, [session.tenantId, linkId]);
    // A message to a customer is the office's (customer.remind's authority, D-082): refused before anything is read.
    const { rows: may } = await c.query(
      `select 1 from ref.command_authority ca join ops.member m on m.role = ca.role where m.id = $1 and m.active and ca.command = 'customer.remind'`,
      [session.memberId],
    );
    if (!may.length || !(await mayReadIn(c, 'paypal.event'))) throw new CoreError('refused');
    const { rows } = await c.query<{ customer_id: string; figure: string; sent: boolean; messaged: boolean; waiting: boolean; phone: string | null; consent: boolean }>(
      `select l.customer_id::text, l.figure,
              l.status = 'sent' and l.paypal_id is not null and ${LIVE_LINK} as sent,
              exists (select 1 from approval.draft d where d.command = 'customer.remind' and d.status = 'executed'
                       and d.payload ->> 'template' = 'paypal_link' and d.payload ->> 'linkId' = l.id::text) as messaged,
              exists (select 1 from approval.draft d where d.command = 'customer.remind' and d.status = 'proposed'
                       and d.payload ->> 'template' = 'paypal_link' and d.payload ->> 'linkId' = l.id::text) as waiting,
              ct.phone_e164 as phone,
              coalesce((select k.granted from books.customer_consent k
                         where k.customer_id = l.customer_id and k.contact_id = ct.id and k.channel = 'whatsapp' and k.purpose = 'service'
                         order by k.created_at desc, k.id desc limit 1), false) as consent
         from ops.paypal_link l
         left join lateral (select p.contact_id from books.party_contact p
                             where p.customer_id = l.customer_id and p.effective_from <= now()
                             order by p.effective_from desc, p.created_at desc, p.id desc limit 1) pc on true
         left join ops.contact ct on ct.tenant_id = l.tenant_id and ct.id = pc.contact_id and ct.erased_at is null
        where l.id = $1`,
      [linkId],
    );
    const at = rows[0];
    if (!at) throw new CoreError('not_found');
    const on = (await capabilitiesOn(c)).has('messaging');
    const outcome: LinkMessage | null = !at.sent
      ? 'not_made'
      : at.messaged
        ? 'messaged'
        : at.waiting
          ? 'waiting'
          : !on
            ? 'messaging_off'
            : !at.phone
              ? 'no_contact'
              : !at.consent
                ? 'no_consent'
                : null;
    if (outcome) return { outcome };
    const figure = parseRef(at.figure) as CellRef;
    const draftId = await proposeDraft(pool, { session }, {
      command: 'customer.remind',
      payload: { customerId: at.customer_id, template: 'paypal_link', figure: at.figure, linkId },
      basedOn: [figure],
      payloadRefs: {},
    });
    return { outcome: 'drafted' as const, draftId };
  });
}

/** Runs the PayPal sweep for one shop now (after its own approval), as the jobs role with no actor: never another shop's. */
export function sweepShopPaypal(jobs: pg.Pool, tenantId: string): Promise<Record<string, number>> {
  return withTx(jobs, { kind: 'system', tenantId }, (c) => sweepPaypalLinks(c));
}

export type PaidNotice = { eventId: string; paypalId: string; status: string; paidMinor: number | null; currency: string | null };
export type Received = 'stored' | 'duplicate' | 'unknown_link' | 'not_paid';

/**
 * A verified INVOICING.INVOICE.PAID notification, on the public pool: the link's shop found by PayPal's id
 * (ops.paypal_route), and one ops.payment_event stored under that shop, once per PayPal event id, with whether the
 * amount is the link's own. Only a full payment (PayPal's PAID) with its amount is stored; a partial or pending one is
 * `not_paid`; a PayPal id no link of ours holds is `unknown_link`. No book row, no draft, no actor.
 */
export async function receivePaypalPaid(pub: pg.Pool, n: PaidNotice, rawSha256: string): Promise<Received> {
  if (n.status !== 'PAID' || n.paidMinor === null || n.paidMinor <= 0 || !n.currency || !/^[0-9a-f]{64}$/.test(rawSha256)) return 'not_paid';
  const { rows: routes } = await pub.query<{ tenant_id: string; link_id: string }>('select tenant_id::text, link_id::text from ops.paypal_route where paypal_id = $1', [
    n.paypalId,
  ]);
  const route = routes[0];
  if (!route) return 'unknown_link';
  return withTx(pub, { kind: 'system', tenantId: route.tenant_id }, async (c) => {
    const { rows } = await c.query(
      `insert into ops.payment_event (tenant_id, provider, provider_event_id, kind, reference, link_id, amount_minor, currency, raw_sha256)
       values ($1, 'paypal', $2, 'invoice_paid', $3, $4, $5, $6, $7)
       on conflict (tenant_id, provider, provider_event_id) do nothing returning id`,
      [route.tenant_id, n.eventId, n.paypalId, route.link_id, n.paidMinor, n.currency, rawSha256],
    );
    return rows.length ? 'stored' : 'duplicate';
  });
}

/**
 * "Record this payment", proposed by a member's own request (or their run): payment.record for the link's customer, by
 * PayPal, its reference PayPal's invoice id, its amount the paypal.event cell of the stored notification and its date
 * that notification's received_at cell. It cites those and the customer's current credit.balance, so a balance that
 * moves before approval makes it stale. A notification a live payment already records is a conflict; one in another
 * currency cannot be recorded here (invalid: the screen says the currency differs).
 */
export async function proposeRecordPaypal(pool: pg.Pool, by: Proposer, eventId: string, findingId?: string): Promise<string> {
  const draft = await withTx(pool, { kind: 'member', session: by.session }, async (c) => {
    const ev = await mintIn(c, 'paypal.event', { event_id: eventId });
    const row = ev.rows[0];
    if (!row) throw new CoreError('not_found');
    const text = (col: string) => textOf(row[col] as never);
    if (text('recorded') !== 'no') throw new CoreError('conflict', { fields: ['eventId'] });
    const amount = row.amount;
    const at = row.received_at;
    if (text('same_currency') !== 'yes' || amount?.kind !== 'money' || at?.kind !== 'timestamp') throw new CoreError('invalid', { fields: ['eventId'] });
    const customerId = text('customer_id');
    const balance = await mintIn(c, 'credit.balance', { customer_id: customerId });
    const cell = (col: string) => ({ snapshotId: ev.id, row: 0, col });
    return {
      command: 'payment.record',
      payload: { direction: 'in', customerId, method: 'paypal', amountMinor: Number(amount.num), reference: text('reference'), paidAt: at.at },
      payloadRefs: { amountMinor: cell('amount') },
      basedOn: [cell('amount'), cell('reference'), cell('received_at'), cell('matches_link'), { snapshotId: balance.id, row: 0, col: 'balance' }],
    };
  });
  return proposeDraft(pool, by, { ...draft, ...(findingId ? { findingId } : {}) });
}

export type PaypalLinkRow = {
  id: string;
  purpose: 'credit' | 'invoice';
  customerId: string;
  invoiceId: string | null;
  figure: CellRef;
  status: 'queued' | 'sent' | 'failed' | 'cancel_queued' | 'cancelled';
  live: boolean;
  mode: 'sandbox' | 'recorded' | null;
  paypalId: string | null;
  payerUrl: string | null;
  sentAt: string | null;
  createdAt: string;
  /** a WhatsApp message carried this link to its customer (an executed paypal_link customer.remind naming it) */
  messaged: boolean;
  /** its message is drafted and waits for a person's approval */
  messageWaiting: boolean;
  events: { id: string; receivedAt: string; recorded: boolean; matchesLink: boolean; sameCurrency: boolean }[];
};

/**
 * The links a page shows (the shop's, or an invoice's), newest first, at most PAYPAL_PAGE (`more` says when there are
 * more), each with whether it is live and the notifications PayPal sent for it: recorded or not, whether the amount is
 * the link's own, whether it is in the shop's currency. Statuses and ids only: an amount is shown from a cited cell.
 */
export async function paypalLinks(c: pg.PoolClient, filter: { invoiceId?: string }): Promise<{ links: PaypalLinkRow[]; more: boolean }> {
  const links = await read<{
    id: string;
    purpose: 'credit' | 'invoice';
    customer_id: string;
    invoice_id: string | null;
    figure: string;
    status: PaypalLinkRow['status'];
    live: boolean;
    mode: 'sandbox' | 'recorded' | null;
    paypal_id: string | null;
    payer_url: string | null;
    sent_at: Date | null;
    created_at: Date;
    messaged: boolean;
    message_waiting: boolean;
  }>(
    c,
    `select l.id::text, l.purpose, l.customer_id::text, l.invoice_id::text, l.figure, l.status, ${LIVE_LINK} as live, l.mode, l.paypal_id, l.payer_url,
            l.sent_at, l.created_at,
            exists (select 1 from approval.draft d where d.command = 'customer.remind' and d.status = 'executed'
                     and d.payload ->> 'template' = 'paypal_link' and d.payload ->> 'linkId' = l.id::text) as messaged,
            exists (select 1 from approval.draft d where d.command = 'customer.remind' and d.status = 'proposed'
                     and d.payload ->> 'template' = 'paypal_link' and d.payload ->> 'linkId' = l.id::text) as message_waiting
       from ops.paypal_link l
      where ($1::uuid is null or l.invoice_id = $1::uuid)
      order by l.created_at desc, l.id limit ${PAYPAL_PAGE + 1}`,
    [filter.invoiceId ?? null],
  );
  const shown = links.slice(0, PAYPAL_PAGE);
  if (!shown.length) return { links: [], more: false };
  const events = await read<{ id: string; link_id: string; received_at: Date; recorded: boolean; matches_link: boolean; same_currency: boolean }>(
    c,
    `select e.id::text, e.link_id::text, e.received_at, e.matches_link, e.currency = (select currency from ops.tenant) as same_currency,
            exists (select 1 from books.payment p
                     where p.direction = 'in' and p.customer_id = l.customer_id and p.reference = e.reference and p.reverses_id is null
                       and not exists (select 1 from books.payment rv where rv.tenant_id = p.tenant_id and rv.reverses_id = p.id)) as recorded
       from ops.payment_event e join ops.paypal_link l on l.tenant_id = e.tenant_id and l.id = e.link_id
      where e.link_id = any($1::uuid[]) order by e.received_at`,
    [shown.map((l) => l.id)],
  );
  return {
    more: links.length > PAYPAL_PAGE,
    links: shown.map((l) => ({
      id: l.id,
      purpose: l.purpose,
      customerId: l.customer_id,
      invoiceId: l.invoice_id,
      figure: parseRef(l.figure) as CellRef,
      status: l.status,
      live: l.live,
      mode: l.mode,
      paypalId: l.paypal_id,
      payerUrl: l.payer_url,
      sentAt: l.sent_at ? l.sent_at.toISOString() : null,
      createdAt: l.created_at.toISOString(),
      messaged: l.messaged,
      messageWaiting: l.message_waiting,
      events: events
        .filter((e) => e.link_id === l.id)
        .map((e) => ({ id: e.id, receivedAt: e.received_at.toISOString(), recorded: e.recorded, matchesLink: e.matches_link, sameCurrency: e.same_currency })),
    })),
  };
}

/**
 * What an invoice's sale still owes on credit, and to whom: a minted invoice.open_credit cell, or null when the sale is
 * reversed, has no customer, or owes nothing (a link is offered only for a positive one).
 */
export async function invoiceOpenCredit(c: pg.PoolClient, invoiceId: string): Promise<{ open: CellRef; snapshotId: string; customerId: string } | null> {
  const open = await mintIn(c, 'invoice.open_credit', { invoice_id: invoiceId });
  const row = open.rows[0];
  const cell = row?.open;
  const customerId = textOf(row?.customer_id as never);
  if (cell?.kind !== 'money' || BigInt(cell.num) <= 0n || textOf(row?.sale_reversed as never) !== 'no' || !customerId) return null;
  return { open: { snapshotId: open.id, row: 0, col: 'open' }, snapshotId: open.id, customerId };
}

export type PaypalDraftRow = {
  id: string;
  command: 'paypal.request' | 'paypal.cancel' | 'payment.record';
  customerId: string;
  invoiceId: string | null;
  figure: CellRef | null;
};

/**
 * The PayPal drafts still waiting for a person: each link request, each cancel, and each "record this payment" whose
 * reference is one of the shop's PayPal invoices; with the cell the amount is (the request's figure, the cancelled
 * link's figure, the record's amountMinor ref), so a page shows the amount from that cell beside Approve.
 */
export async function paypalDrafts(c: pg.PoolClient): Promise<PaypalDraftRow[]> {
  const rows = await read<{
    id: string;
    command: PaypalDraftRow['command'];
    payload: Record<string, unknown>;
    payload_refs: Record<string, CellRef>;
    link_customer: string | null;
    link_invoice: string | null;
    link_figure: string | null;
  }>(
    c,
    `select d.id::text, d.command, d.payload, d.payload_refs, l.customer_id::text as link_customer, l.invoice_id::text as link_invoice, l.figure as link_figure
       from approval.draft d
       left join ops.paypal_link l on d.command = 'paypal.cancel' and l.tenant_id = d.tenant_id and l.id::text = d.payload ->> 'linkId'
      where d.status = 'proposed'
        and (d.command in ('paypal.request', 'paypal.cancel')
             or (d.command = 'payment.record' and exists (select 1 from ops.paypal_link x where x.paypal_id = d.payload ->> 'reference')))
      order by d.created_at, d.id limit ${PAYPAL_PAGE}`,
  );
  return rows.map((d) => ({
    id: d.id,
    command: d.command,
    customerId: d.command === 'paypal.cancel' ? (d.link_customer ?? '') : String(d.payload.customerId ?? ''),
    invoiceId: d.command === 'paypal.cancel' ? d.link_invoice : typeof d.payload.invoiceId === 'string' ? d.payload.invoiceId : null,
    figure:
      d.command === 'paypal.request'
        ? parseRef(String(d.payload.figure ?? ''))
        : d.command === 'paypal.cancel'
          ? parseRef(d.link_figure ?? '')
          : (d.payload_refs.amountMinor ?? null),
  }));
}

/** What the signed-in member may start or decide here: links (paypal.request, paypal.cancel) and payments (payment.record). */
export async function paypalAuthority(c: pg.PoolClient, memberId: string): Promise<{ canSend: boolean; canRecord: boolean }> {
  const rows = await read<{ command: string }>(
    c,
    `select ca.command from ref.command_authority ca join ops.member m on m.role = ca.role
      where m.id = $1 and m.active and ca.command in ('paypal.request', 'payment.record')`,
    [memberId],
  );
  const may = new Set(rows.map((r) => r.command));
  // Recording a PayPal payment cites PayPal's notification (paypal.event), a read of the office's (D-082): no "Record
  // this payment" for a role that holds payment.record at the counter but may not read it.
  return { canSend: may.has('paypal.request'), canRecord: may.has('payment.record') && (await mayReadIn(c, 'paypal.event')) };
}

/** Whether a page may show PayPal at all: the commands and reads are registered and the tables exist (the migrator's). */
export async function paypalReady(c: pg.PoolClient): Promise<boolean> {
  // core's registries spread the PayPal commands and reads (commands.ts, queries.ts); a schema without the tables hides it.
  if (!COMMANDS.has('paypal.request') || !COMMANDS.has('paypal.cancel') || !QUERIES.has('paypal.event')) return false;
  const rows = await read<{ ready: boolean }>(
    c,
    `select to_regclass('ops.paypal_link') is not null and to_regclass('ops.payment_event') is not null and to_regclass('ops.paypal_route') is not null as ready`,
  );
  return rows[0]?.ready === true;
}
