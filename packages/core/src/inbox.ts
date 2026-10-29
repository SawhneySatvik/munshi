// The inbox (BLUEPRINT §8.6, §2.10.7). The webhook's side: a message from WhatsApp finds its shop through ops.phone_route
// (the keyed HMAC of the sender's number) and is stored with no actor, as munshi_public; a number no shop listed stores
// nothing; Meta's retries store once; a provider's later status moves its delivery. A member's side: handle or ignore an
// item, store a transcript, and read figures off a message, each from the span the model pointed at, by code (EX2).
// Ops rows only: nothing here writes a book or reaches a command runner, so the webhook can import this file (W3). A
// STOP is handled through consent.record (commands-messaging.ts), which records the withdrawal beside it.
import { createHash, createHmac } from 'node:crypto';
import type pg from 'pg';
import { CoreError } from './errors.ts';
import { readSpan, type Span, type SpanRefusal } from './numbers.ts';
import { type Session, withTx } from './session.ts';
import { businessDate } from './time.ts';

/** A phone as the books hold it, `+` and 8 to 15 digits; Meta's `from` comes without the plus (W8). */
export function e164(raw: string): string | null {
  const digits = raw.trim().replace(/^\+/, '');
  return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : null;
}

/** The route key's HMAC of a number: what ops.phone_route stores instead of the number (its own key, never the identity key). */
export const phoneHmac = (routeKey: Buffer, phone: string): Buffer => createHmac('sha256', routeKey).update(phone, 'utf8').digest();

// A whole message that is one of these is an opt-out (the database also catches a bare STOP itself).
const STOP_WORDS = new Set(['stop', 'unsubscribe', 'band karo', 'बंद करो']);
const isStop = (text: string | null) =>
  !!text && STOP_WORDS.has(text.normalize('NFKC').toLowerCase().replace(/[\s.!।]+$/u, '').trim().replace(/\s+/g, ' '));

export type InboundMessage = { providerMessageId: string; from: string; kind: 'text' | 'audio' | 'image' | 'other'; text: string | null };

async function routeOf(pub: pg.Pool, routeKey: Buffer, raw: string): Promise<{ tenantId: string; phone: string } | null> {
  const phone = e164(raw);
  if (!phone) return null;
  const { rows } = await pub.query<{ tenant_id: string }>('select tenant_id::text from ops.phone_route where phone_hmac = $1 and erased_at is null', [
    phoneHmac(routeKey, phone),
  ]);
  return rows[0] ? { tenantId: rows[0].tenant_id, phone } : null;
}

/** Stores one inbound message on `pub` (munshi_public): its id, or null for a number no shop routes (W4) and for a
 * provider id already stored (W2). */
export async function receiveInbound(pub: pg.Pool, routeKey: Buffer, m: InboundMessage): Promise<string | null> {
  const route = await routeOf(pub, routeKey, m.from);
  if (!route) return null;
  return withTx(pub, { kind: 'system', tenantId: route.tenantId }, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into ops.inbound_message (tenant_id, provider_message_id, from_address, kind, text, opt_out, received_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (tenant_id, provider_message_id) do nothing returning id`,
      [route.tenantId, m.providerMessageId, route.phone, m.kind, m.text, isStop(m.text)],
    );
    return rows[0]?.id ?? null;
  });
}

export type ProviderStatus = { providerMessageId: string; status: 'sent' | 'delivered' | 'read' | 'failed'; recipient: string; errorCode: string | null };

/** A provider's status for a delivery it sent, on `pub`: true if it moved the delivery. A status the delivery cannot
 * take (out of order, or for a delivery never sent) moves nothing. */
export async function recordProviderStatus(pub: pg.Pool, routeKey: Buffer, s: ProviderStatus): Promise<boolean> {
  const route = s.status === 'sent' ? null : await routeOf(pub, routeKey, s.recipient);
  if (!route) return false;
  try {
    return await withTx(pub, { kind: 'system', tenantId: route.tenantId }, async (c) => {
      const r = await c.query('update ops.delivery set status = $2, error_code = $3 where provider_message_id = $1 and status <> $2', [
        s.providerMessageId,
        s.status,
        s.errorCode,
      ]);
      return r.rowCount === 1;
    });
  } catch (err) {
    if (err instanceof CoreError && err.sqlstate === 'MS010') return false;
    throw err;
  }
}

/** A member handles an inbox item, or ignores it. A STOP can only be handled by consent.record naming it. */
export async function handleInbound(pool: pg.Pool, session: Session, messageId: string, status: 'handled' | 'ignored'): Promise<void> {
  await withTx(pool, { kind: 'member', session }, async (c) => {
    const r = await c.query('update ops.inbound_message set status = $2 where id = $1', [messageId, status]);
    if (r.rowCount !== 1) throw new CoreError('not_found');
  });
}

/** A member's run stores a voice note's transcript, once. */
export async function saveTranscript(pool: pg.Pool, session: Session, messageId: string, transcript: string): Promise<void> {
  await withTx(pool, { kind: 'member', session }, async (c) => {
    const r = await c.query('update ops.inbound_message set transcript = $2, transcribed_at = now() where id = $1', [messageId, transcript]);
    if (r.rowCount !== 1) throw new CoreError('not_found');
  });
}

// What the model points at: a field and the span of the transcript (or a text message's text) holding it, in code points.
// It gives no value: code reads the figure from the span (EX2).
export type SpanAt = Span & ({ field: 'amount' } | { field: 'quantity' } | { field: 'date'; direction?: 'next' | 'last' });

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** Reads each figure from its span and stores it as an extract of the message, for an active member's run. A span core
 * cannot read, or whose digits the database reads differently, fills nothing: its slot holds the reason. */
export async function recordExtracts(
  pool: pg.Pool,
  by: { session: Session; runId: string },
  messageId: string,
  spans: SpanAt[],
): Promise<({ extractId: string } | { refusal: SpanRefusal | 'not_reread' })[]> {
  return withTx(pool, { kind: 'member', session: by.session }, async (c) => {
    const { rows } = await c.query<{ source: string | null; time_zone: string }>(
      `select coalesce(i.transcript, i.text) as source, t.time_zone from ops.inbound_message i, ops.tenant t where i.id = $1 and i.erased_at is null`,
      [messageId],
    );
    const source = rows[0]?.source;
    if (!rows[0] || !source) throw new CoreError('not_found');
    const today = businessDate(new Date(), rows[0].time_zone);
    const chars = [...source];
    const out: ({ extractId: string } | { refusal: SpanRefusal | 'not_reread' })[] = [];
    for (const s of spans) {
      const read = readSpan(source, s, s.field === 'date' ? { field: 'date', today, direction: s.direction ?? 'next' } : { field: s.field });
      if (!read.ok) {
        out.push({ refusal: read.refusal });
        continue;
      }
      let [start, end] = [s.start, s.end];
      // A digit figure is stored on its digit run alone ("₹1,500" as "1,500"): the database re-reads that run itself and
      // knows no rupee sign or word around it.
      if (read.field !== 'date' && read.parsedAs === 'digits') {
        const text = chars.slice(start, end).join('');
        const run = /\p{Nd}[\p{Nd},.]*/u.exec(text) as RegExpExecArray;
        start += [...text.slice(0, run.index)].length;
        end = start + [...run[0]].length;
      }
      const values =
        read.field === 'amount'
          ? { num: read.minor, day: null, parsedAs: read.parsedAs }
          : read.field === 'quantity'
            ? { num: read.count * 1000, day: null, parsedAs: read.parsedAs }
            : { num: null, day: read.day, parsedAs: 'words' as const };
      await c.query('savepoint extract');
      try {
        const { rows: made } = await c.query<{ id: string }>(
          `insert into ops.inbound_extract (tenant_id, message_id, run_id, field, num, day, span_start, span_end, span_sha256, parsed_as)
           values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
          [messageId, by.runId, read.field, values.num, values.day, start, end, sha256(chars.slice(start, end).join('')), values.parsedAs],
        );
        await c.query('release savepoint extract');
        out.push({ extractId: (made[0] as { id: string }).id });
      } catch (err) {
        await c.query('rollback to savepoint extract');
        if ((err as { code?: string }).code !== 'MS006') throw err;
        out.push({ refusal: 'not_reread' }); // the database's own reading of the digits differs: nothing is filled
      }
    }
    return out;
  });
}
