// The outbox (BLUEPRINT §8.6): how the jobs role sends what the books queued. A message is a book written only by a
// person's command or an approved draft; its delivery is derived by the database in that transaction (19_messaging.sql).
// Here the jobs role claims each queued delivery once, rechecks it at send time (the address, a STOP, consent, the
// deadline, the 24-hour window) and hands it to the sender its mode names. jobs-messaging.ts runs the sweep, so this
// file is in gate J1's scan: it imports nothing of core's but types, and no @munshi value. The senders are wired in by
// the deploy (wireChannels); unwired, the sweep sends nothing.
import type { Channels, Sender } from '@munshi/adapters/channels';
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
};

// Each run takes at most this many deliveries per shop; the rest wait for the next trigger.
const BATCH = 100;

/** The outbox job's run, in its slot's transaction under one shop's context, as munshi_jobs with no actor. */
export async function sweepOutbox(c: pg.PoolClient): Promise<Removed> {
  const channels = wired;
  if (!channels) return {};
  // A pending delivery waits for its real sender; one this deploy has not switched on is left queued, not failed.
  const real = [channels.whatsapp && 'whatsapp', channels.instagram && 'instagram'].filter(Boolean);
  const { rows: due } = await c.query<Due>(
    `select d.id, d.tenant_id, d.channel, d.mode, d.to_address, d.message_id, coalesce(m.text_id, d.test_text_id) as text_id,
            m.recipient_kind, m.recipient_id, m.campaign_id, m.template_code
       from ops.delivery d left join books.outbound_message m on m.tenant_id = d.tenant_id and m.id = d.message_id
      where d.status = 'queued' and d.erased_at is null and (d.mode = 'recorded' or (d.mode = 'pending' and d.channel = any($1::text[])))
      order by d.created_at, d.id
      limit ${BATCH}`,
    [real],
  );
  const done: Removed = {};
  for (const d of due) {
    const send = (d.mode === 'recorded' ? channels.recorded : d.channel === 'instagram' ? channels.instagram : channels.whatsapp) as Sender;
    // A pending delivery takes its adapter as it is claimed; a recorded one stays recorded (delivery_status).
    const mode = d.mode === 'pending' ? (d.channel === 'instagram' ? 'instagram' : 'cloud_api') : d.mode;
    const status = await deliverOnce(c, d, mode, send);
    if (status) done[status] = (done[status] ?? 0) + 1;
  }
  return done;
}

// One delivery, at most once. The claim (queued → sending) is taken first and only its winner goes on: a second sweep
// blocks on the claimed row until the first commits, then finds it no longer queued. Everything after the claim runs
// under a savepoint, so a failure there undoes only that delivery's outcome and leaves it claimed, marked `failed`,
// never queued again. Residual: the slot is one transaction (jobs.ts), so a crash between a send and its commit
// requeues that send.
async function deliverOnce(c: pg.PoolClient, d: Due, mode: string, send: Sender): Promise<string | null> {
  await c.query('savepoint claim');
  try {
    const claimed = await c.query(`update ops.delivery set status = 'sending', mode = $2 where id = $1 and status = 'queued' and erased_at is null`, [d.id, mode]);
    await c.query('release savepoint claim');
    if (claimed.rowCount !== 1) return null; // another sweep holds it
  } catch {
    await c.query('rollback to savepoint claim');
    return null;
  }
  await c.query('savepoint delivery');
  try {
    let outcome: { status: string; provider: string | null; code: string | null };
    const end = await recheck(c, d, mode);
    if (end) {
      outcome = { status: end.status, provider: null, code: null };
    } else {
      const r = await send({
        deliveryId: d.id,
        tenantId: d.tenant_id,
        channel: d.channel,
        to: d.to_address,
        body: (await bodyOf(c, d.text_id)) as string, // the recheck found it unerased
        campaignId: d.channel === 'instagram' ? d.recipient_id : null,
        accountRef: d.channel === 'instagram' ? await accountOf(c, d.tenant_id) : null,
      }).catch((): { ok: false; errorCode: null } => ({ ok: false, errorCode: null }));
      outcome = r.ok ? { status: 'sent', provider: r.providerMessageId, code: null } : { status: 'failed', provider: null, code: r.errorCode };
    }
    await c.query('update ops.delivery set status = $2, provider_message_id = $3, error_code = $4 where id = $1', [d.id, outcome.status, outcome.provider, outcome.code]);
    await c.query('release savepoint delivery');
    return outcome.status;
  } catch {
    await c.query('rollback to savepoint delivery');
    await c.query(`update ops.delivery set status = 'failed' where id = $1`, [d.id]);
    return 'failed';
  }
}

const bodyOf = async (c: pg.PoolClient, textId: string) =>
  (await c.query<{ body: string | null }>('select body from ops.message_text where id = $1', [textId])).rows[0]?.body ?? null;

// The configured Instagram account the shop's latest grant names.
const accountOf = async (c: pg.PoolClient, tenantId: string) =>
  (
    await c.query<{ account_ref: string | null }>(
      `select account_ref from platform.channel_grant where tenant_id = $1 and channel = 'instagram' order by effective_from desc, id desc limit 1`,
      [tenantId],
    )
  ).rows[0]?.account_ref ?? null;

// The send-time recheck (W5, W7): it can only stop a delivery, never widen one. Past its deadline it expires. With no
// address, or erased words, or a person whose current contact no longer holds this address (erased, or re-linked to a
// new phone), it is blocked; so is a campaign or reminder whose latest consent from the current contact is no longer
// granted, and a message to a customer who sent a STOP from this address since that consent (since the message was
// written, for a message that needs none). A free-form WhatsApp message needs the person's own message within the
// last 24 hours, or it waits.
async function recheck(c: pg.PoolClient, d: Due, mode: string): Promise<{ status: string } | null> {
  const purpose = d.campaign_id && d.recipient_kind === 'customer' ? 'marketing' : (REMINDERS as readonly string[]).includes(d.template_code ?? '') ? 'service' : null;
  const { rows } = await c.query<{ expired: boolean; reachable: boolean; stopped: boolean; consented: boolean; window: boolean; worded: boolean }>(
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
            exists (select 1 from ops.inbound_message i, d where i.from_address = d.to_address and i.received_at > now() - interval '24 hours') as window`,
    [d.id, purpose],
  );
  const r = rows[0];
  if (!r || r.expired) return { status: 'expired' };
  if ((d.channel !== 'instagram' && !d.to_address) || !r.worded || !r.reachable || r.stopped || !r.consented) return { status: 'blocked' };
  if (mode === 'cloud_api' && !r.window) return { status: 'needs_window' };
  return null;
}
