// The outbox (BLUEPRINT §8.6): how the jobs role sends what the books queued. A message is a book written only by a
// person's command or an approved draft; its delivery is derived by the database in that transaction (19_messaging.sql).
// Here the jobs role claims each queued delivery once, rechecks it at send time (the address, a STOP, consent, the
// deadline, the 24-hour window, and for a real send the shop's grant and, on WhatsApp, the recipient still listed) and
// hands it to the sender its mode names. A real sender is reached only for a real shop (data_class live, D-080): a
// sample shop's pending delivery ends blocked before any claim. A pending delivery whose channel has no sender here
// (send mode recorded, or no credential) waits queued, and lapses as expired at its deadline (not_after), so a late send
// stays inside the window its approval gave. jobs-messaging.ts runs the sweep, so this file is in gate J1's scan: it
// imports nothing of core's but types, and no @munshi value. The senders are wired in by the deploy (wireChannels);
// unwired, the sweep sends nothing.
import type { Channels, Outbound, Sender, Sent, TemplatePurpose } from '@munshi/adapters/channels';
import type pg from 'pg';
import type { Removed } from './jobs-core.ts';

// customer.remind's templates: service messages, which reach a customer only with service consent (b_outbound_derive);
// the sweep rechecks it by the template code, since the jobs role cannot read the draft that wrote the message.
export const REMINDERS = ['credit_due', 'package_expiring'] as const;

// ---- the senders ----------------------------------------------------------------------------------------------------

let wired: Channels | null = null;

/** The deploy's senders (channelsFor in @munshi/adapters/channels); null unwires them, and the sweep then sends nothing. */
export function wireChannels(channels: Channels | null): void {
  wired = channels;
}

// ---- the sweep ------------------------------------------------------------------------------------------------------

type Due = {
  id: string;
  tenant_id: string;
  channel: 'whatsapp' | 'sms' | 'instagram';
  mode: string;
  to_address: string | null;
  message_id: string | null;
  text_id: string;
  recipient_kind: string | null;
  recipient_id: string | null;
  campaign_id: string | null;
  template_code: string | null;
  data_class: string | null;
  lapsed: boolean;
};

// Each run takes at most this many deliveries per shop; the rest wait for the next trigger.
const BATCH = 100;

/**
 * The outbox job's run, in its slot's transaction under one shop's context, as munshi_jobs with no actor. `checkpoint`
 * commits the work so far and begins again under the same context (jobs.ts): each claim is committed before its
 * provider is called, and each outcome after.
 */
export async function sweepOutbox(c: pg.PoolClient, checkpoint: () => Promise<void>): Promise<Removed> {
  const channels = wired;
  if (!channels) return {};
  const real = [channels.whatsapp && 'whatsapp', channels.instagram && 'instagram'].filter(Boolean);
  const { rows: due } = await c.query<Due>(
    `select d.id, d.tenant_id, d.channel, d.mode, d.to_address, d.message_id, coalesce(m.text_id, d.test_text_id) as text_id,
            m.recipient_kind, m.recipient_id, m.campaign_id, m.template_code,
            (select t.data_class from ops.tenant t where t.tenant_id = d.tenant_id) as data_class, d.not_after <= now() as lapsed
       from ops.delivery d left join books.outbound_message m on m.tenant_id = d.tenant_id and m.id = d.message_id
      where d.status = 'queued' and d.erased_at is null and d.mode in ('recorded', 'pending')
      order by d.created_at, d.id
      limit ${BATCH}`,
  );
  const done: Removed = {};
  const count = (status: string | null) => {
    if (status) done[status] = (done[status] ?? 0) + 1;
  };
  for (const d of due) {
    // A real send is a real shop's alone: a sample shop's pending delivery ends blocked before any claim, never sent.
    if (d.mode === 'pending' && d.data_class !== 'live') {
      count(await endUnclaimed(c, d.id, 'blocked'));
      continue;
    }
    // No sender for its channel here: it waits, unclaimed, and lapses at its deadline.
    if (d.mode === 'pending' && !real.includes(d.channel)) {
      if (d.lapsed) count(await endUnclaimed(c, d.id, 'expired'));
      continue;
    }
    const send = (d.mode === 'recorded' ? channels.recorded : d.channel === 'instagram' ? channels.instagram : channels.whatsapp) as Sender;
    // A pending delivery takes its adapter as it is claimed; a recorded one stays recorded (delivery_status).
    const mode = d.mode === 'pending' ? (d.channel === 'instagram' ? 'instagram' : 'cloud_api') : d.mode;
    count(await deliverOnce(c, d, mode, send, channels.templates ?? {}, checkpoint));
  }
  return done;
}

// Ends a queued delivery without claiming it (queued → blocked or expired), under a savepoint; null if another sweep
// holds it.
async function endUnclaimed(c: pg.PoolClient, id: string, status: 'blocked' | 'expired'): Promise<string | null> {
  await c.query('savepoint unclaimed');
  try {
    const r = await c.query(`update ops.delivery set status = $2 where id = $1 and status = 'queued'`, [id, status]);
    await c.query('release savepoint unclaimed');
    return r.rowCount === 1 ? status : null;
  } catch {
    await c.query('rollback to savepoint unclaimed');
    return null;
  }
}

// The template a WhatsApp send outside the window may use: a campaign's, or a reminder's own.
const purposeOf = (d: Due): TemplatePurpose | null =>
  d.campaign_id && d.recipient_kind === 'customer'
    ? 'campaign'
    : (REMINDERS as readonly string[]).includes(d.template_code ?? '')
      ? (d.template_code as TemplatePurpose)
      : null;

/**
 * Whether the approved words can go as the purpose's template, unchanged: its approved text is known (the deploy's
 * WHATSAPP_TEMPLATE_<PURPOSE>_TEXT, holding {{1}} once), the whole text with the words is at most 1024 characters
 * (Meta's body limit, templates/components), and the words hold no new line, tab or run of five spaces (UNVERIFIED:
 * Meta documents only "Template validation error", 132018; this is the rule commonly reported). Otherwise the send
 * waits for the person to write (needs_window): no template goes out with words its approver did not see.
 */
export const templateFits = (text: string | undefined, words: string | null): boolean =>
  !!text && !!words && !/[\n\t]| {5}/.test(words) && text.replace('{{1}}', words).length <= 1024;

// One delivery, at most once, across a crash too. The claim (queued → sending) is taken first and only its winner goes
// on: a second sweep blocks on the claimed row until the first commits, then finds it no longer queued. The recheck
// runs under a savepoint; an ending it finds (or a failure in it) is committed with the claim. Otherwise the claim is
// committed BEFORE the provider is called, and the outcome in its own commit after: a crash or a failure in between
// leaves the delivery `sending`, which no sweep selects again, so it is never sent twice. A send whose answer never
// came (a timeout, a dropped connection: the provider may have taken it) stays `sending` too, unconfirmed, never
// marked failed and never retried.
async function deliverOnce(
  c: pg.PoolClient,
  d: Due,
  mode: string,
  send: Sender,
  templates: Readonly<Partial<Record<TemplatePurpose, string>>>,
  checkpoint: () => Promise<void>,
): Promise<string | null> {
  await c.query('savepoint claim');
  try {
    const claimed = await c.query(`update ops.delivery set status = 'sending', mode = $2 where id = $1 and status = 'queued' and erased_at is null`, [d.id, mode]);
    await c.query('release savepoint claim');
    if (claimed.rowCount !== 1) return null; // another sweep holds it
  } catch {
    await c.query('rollback to savepoint claim');
    return null;
  }
  let out: Outbound;
  await c.query('savepoint delivery');
  try {
    const purpose = purposeOf(d);
    const body = await bodyOf(c, d.text_id);
    const checked = await recheck(c, d, mode, templateFits(purpose ? templates[purpose] : undefined, body));
    if ('status' in checked) {
      await c.query('update ops.delivery set status = $2 where id = $1', [d.id, checked.status]);
      await c.query('release savepoint delivery');
      await checkpoint();
      return checked.status;
    }
    out = {
      deliveryId: d.id,
      tenantId: d.tenant_id,
      channel: d.channel,
      to: d.to_address,
      body: body as string, // the recheck found it unerased
      campaignId: d.channel === 'instagram' ? d.recipient_id : null,
      accountRef: d.channel === 'instagram' ? await accountOf(c, d.tenant_id) : null,
      window: checked.window,
      purpose,
    };
    await c.query('release savepoint delivery');
  } catch {
    await c.query('rollback to savepoint delivery');
    await c.query(`update ops.delivery set status = 'failed' where id = $1`, [d.id]);
    await checkpoint();
    return 'failed';
  }
  await checkpoint(); // the claim is committed: from here on, this delivery is never sent again
  const r = await send(out).catch((): Sent => ({ ok: false, errorCode: null, unconfirmed: true }));
  if (!r.ok && r.unconfirmed) return 'unconfirmed';
  const outcome = r.ok ? { status: 'sent', provider: r.providerMessageId, code: null } : { status: 'failed', provider: null, code: r.errorCode };
  await c.query('update ops.delivery set status = $2, provider_message_id = $3, error_code = $4 where id = $1', [d.id, outcome.status, outcome.provider, outcome.code]);
  await checkpoint();
  return outcome.status;
}

const bodyOf = async (c: pg.PoolClient, textId: string) =>
  (await c.query<{ body: string | null }>('select body from ops.message_text where id = $1', [textId])).rows[0]?.body ?? null;

// The configured Instagram account the shop's latest grant names, only while that grant is granted.
const accountOf = async (c: pg.PoolClient, tenantId: string) =>
  (
    await c.query<{ account_ref: string | null }>(
      `select case when granted then account_ref end as account_ref from platform.channel_grant
        where tenant_id = $1 and channel = 'instagram' order by effective_from desc, id desc limit 1`,
      [tenantId],
    )
  ).rows[0]?.account_ref ?? null;

// The send-time recheck (W5, W7, M1): it can only stop a delivery, never widen one. Past its deadline it expires. With
// no address, or erased words, or a person whose current contact no longer holds this address (erased, or re-linked to
// a new phone), it is blocked; so is a campaign or reminder whose latest consent from the current contact is no longer
// granted, and a message to a customer who sent a STOP from this address since that consent (since the message was
// written, for a message that needs none). A real send is blocked too once the shop's latest grant for the channel is
// withdrawn, and on WhatsApp once its recipient is no longer listed. A WhatsApp message needs the person's own message
// within the last 24 hours, or a template its words fit (`templated`), or it waits. Passing, it answers whether the
// window is open.
async function recheck(c: pg.PoolClient, d: Due, mode: string, templated: boolean): Promise<{ status: string } | { window: boolean }> {
  const purpose = d.campaign_id && d.recipient_kind === 'customer' ? 'marketing' : (REMINDERS as readonly string[]).includes(d.template_code ?? '') ? 'service' : null;
  const realChannel = mode === 'cloud_api' ? 'whatsapp' : mode === 'instagram' ? 'instagram' : null;
  const { rows } = await c.query<{
    expired: boolean;
    reachable: boolean;
    stopped: boolean;
    consented: boolean;
    window: boolean;
    worded: boolean;
    granted: boolean;
    listed: boolean;
  }>(
    `with d as (select * from ops.delivery where id = $1),
          m as (select * from books.outbound_message where id = (select message_id from d)),
          cur as (select p.contact_id from books.party_contact p, m
                   where p.effective_from <= now()
                     and m.recipient_id = case m.recipient_kind when 'customer' then p.customer_id when 'supplier' then p.supplier_id else p.staff_id end
                   order by p.effective_from desc, p.created_at desc, p.id desc limit 1),
          k as (select k.granted, k.created_at from books.customer_consent k, m, cur
                 where k.customer_id = m.recipient_id and k.contact_id = cur.contact_id and k.channel = m.channel and k.purpose = $2
                 order by k.created_at desc, k.id desc limit 1)
     select (select not_after <= now() from d) as expired,
            exists (select 1 from ops.message_text t where t.id = (select coalesce((select text_id from m), (select test_text_id from d))) and t.body is not null) as worded,
            case when (select message_id from d) is null or (select recipient_kind from m) = 'public' then true
                 else exists (select 1 from ops.contact ct, cur, d where ct.id = cur.contact_id and ct.erased_at is null and ct.phone_e164 = d.to_address) end as reachable,
            (select recipient_kind from m) = 'customer' and exists (
              select 1 from ops.inbound_message i, d, m
               where i.from_address = d.to_address and i.opt_out and i.received_at > coalesce((select created_at from k), m.created_at)) as stopped,
            $2::text is null or coalesce((select granted from k), false) as consented,
            exists (select 1 from ops.inbound_message i, d where i.from_address = d.to_address and i.received_at > now() - interval '24 hours') as window,
            $3::text is null or coalesce((select g.granted from platform.channel_grant g, d where g.tenant_id = d.tenant_id and g.channel = $3
                                            order by g.effective_from desc, g.id desc limit 1), false) as granted,
            $3::text is distinct from 'whatsapp' or exists (
              select 1 from ops.channel_recipient r, d where r.tenant_id = d.tenant_id and r.removed_at is null
                 and (r.contact_id = (select contact_id from cur) or r.member_id = d.test_member_id)) as listed`,
    [d.id, purpose, realChannel],
  );
  const r = rows[0];
  if (!r || r.expired) return { status: 'expired' };
  if ((d.channel !== 'instagram' && !d.to_address) || !r.worded || !r.reachable || r.stopped || !r.consented) return { status: 'blocked' };
  if (!r.granted || !r.listed) return { status: 'blocked' };
  if (mode === 'cloud_api' && !r.window && !templated) return { status: 'needs_window' };
  return { window: r.window };
}
