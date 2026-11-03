// What a person's agent taps on the inbox and campaigns need before the agent runs, read and written as the signed-in
// member, so the server never takes a customer, a request or an offer from the form: who sent a message (the contact
// whose phone it came from, and the customer that contact is linked to now), the order request it makes, whether a
// reply or an order already waits on it, a campaign's offer, and a voice note's words heard from a clip a person
// attached (an owner's or a manager's, stored once). Ops rows only: a draft still waits for a person, and the approval
// checks the sender's current phone again.
import type pg from 'pg';
import { CoreError } from './errors.ts';
import { intakeInstagram, intakeWhatsapp } from './intake.ts';
import { type Session, withTx } from './session.ts';

export type MessageParty = { customerId: string | null; contactId: string | null };

const member = (session: Session) => ({ kind: 'member', session }) as const;

/** The message's sender: their contact (by the phone it came from) and the customer that contact is linked to now. */
export async function messageParty(pool: pg.Pool, session: Session, messageId: string): Promise<MessageParty> {
  return withTx(pool, member(session), async (c) => {
    const { rows: m } = await c.query<{ from_address: string | null }>('select from_address from ops.inbound_message where id = $1 and erased_at is null', [messageId]);
    if (!m[0]) throw new CoreError('not_found');
    if (!m[0].from_address) return { customerId: null, contactId: null };
    const { rows } = await c.query<{ contact_id: string; customer_id: string | null }>(
      `select ct.id::text as contact_id,
              (select p.customer_id::text from books.party_contact p where p.contact_id = ct.id and p.effective_from <= now()
                order by p.effective_from desc, p.created_at desc, p.id desc limit 1) as customer_id
         from ops.contact ct where ct.phone_e164 = $1 and ct.erased_at is null`,
      [m[0].from_address],
    );
    return { customerId: rows[0]?.customer_id ?? null, contactId: rows[0]?.contact_id ?? null };
  });
}

/**
 * The order request the message made, still open, and whether an order drafted from it still waits for a decision
 * (`drafted`: then nothing more is drafted); made now as the member (the shop's first branch) when it has none
 * (`created`: a run that drafts nothing ends it again, requestUndrafted).
 */
export async function messageRequest(
  pool: pg.Pool,
  session: Session,
  messageId: string,
  contactId: string | null,
): Promise<{ requestId: string; created: boolean; drafted: boolean }> {
  return withTx(pool, member(session), async (c) => {
    const { rows: open } = await c.query<{ id: string; drafted: boolean }>(
      `select r.id::text, exists (select 1 from approval.draft d where d.tenant_id = r.tenant_id and d.id = r.draft_id and d.status = 'proposed') as drafted
         from ops.order_request r where r.inbound_message_id = $1 and r.state in ('new', 'drafted') order by r.created_at limit 1`,
      [messageId],
    );
    if (open[0]) return { requestId: open[0].id, created: false, drafted: open[0].drafted };
    const { rows: m } = await c.query<{ channel: string }>('select channel from ops.inbound_message where id = $1 and erased_at is null', [messageId]);
    const { rows: shop } = await c.query<{ id: string }>('select id::text from ops.shop order by created_at, id limit 1');
    if (!m[0] || !shop[0]) throw new CoreError('not_found');
    const input = { shopId: shop[0].id, kind: 'goods' as const, inboundMessageId: messageId, ...(contactId ? { contactId } : {}) };
    const made = m[0].channel === 'instagram' ? await intakeInstagram(c, input) : await intakeWhatsapp(c, input);
    return { requestId: made.requestId, created: true, drafted: false };
  });
}

/** The request now waits on the order.confirm draft drafted from it. */
export async function requestDrafted(pool: pg.Pool, session: Session, requestId: string, draftId: string): Promise<void> {
  await withTx(pool, member(session), async (c) => {
    const r = await c.query(`update ops.order_request set state = 'drafted', draft_id = $2 where id = $1 and state in ('new', 'drafted')`, [requestId, draftId]);
    if (r.rowCount !== 1) throw new CoreError('not_found');
  });
}

/** A request this tap made, from which the run drafted nothing, is ended again (declined, `other`, as the member): no
 * request is left waiting that no customer's code or person's draft stands behind. */
export async function requestUndrafted(pool: pg.Pool, session: Session, requestId: string): Promise<void> {
  await withTx(pool, member(session), (c) => c.query(`update ops.order_request set state = 'declined', reason = 'other' where id = $1 and state = 'new'`, [requestId]));
}

/** Whether a reply drafted for this message still waits for a decision (then no second one is drafted). */
export async function replyWaiting(pool: pg.Pool, session: Session, messageId: string): Promise<boolean> {
  return withTx(pool, member(session), async (c) => {
    const { rows } = await c.query(`select 1 from approval.draft where command = 'message.reply' and status = 'proposed' and payload->>'messageId' = $1`, [messageId]);
    return rows.length > 0;
  });
}

/** A campaign's offer, as the campaign names it (null: none), for the copy writer's reads. */
export async function campaignOffer(pool: pg.Pool, session: Session, campaignId: string): Promise<string | null> {
  return withTx(pool, member(session), async (c) => {
    const { rows } = await c.query<{ offer_id: string | null }>('select offer_id::text from ops.campaign where id = $1', [campaignId]);
    if (!rows[0]) throw new CoreError('not_found');
    return rows[0].offer_id;
  });
}

const OWN_CLIP = ['owner', 'manager'];

/** Whether the member may attach a voice note's clip for Munshi to hear (an owner or a manager). */
export async function mayAttachClip(pool: pg.Pool, session: Session): Promise<boolean> {
  return withTx(pool, member(session), async (c) => {
    const { rows } = await c.query<{ role: string }>('select role from ops.member where id = $1 and active', [session.memberId]);
    return OWN_CLIP.includes(rows[0]?.role ?? '');
  });
}

/** A voice note's words heard from a clip a person attached, stored once as its transcript: an owner's or a manager's
 * only (staff are refused), and only on a voice note. */
export async function saveClipTranscript(pool: pg.Pool, session: Session, messageId: string, transcript: string): Promise<void> {
  await withTx(pool, member(session), async (c) => {
    const { rows } = await c.query<{ role: string }>('select role from ops.member where id = $1 and active', [session.memberId]);
    if (!OWN_CLIP.includes(rows[0]?.role ?? '')) throw new CoreError('refused');
    const r = await c.query(`update ops.inbound_message set transcript = $2, transcribed_at = now() where id = $1 and kind = 'audio'`, [messageId, transcript]);
    if (r.rowCount !== 1) throw new CoreError('not_found');
  });
}
