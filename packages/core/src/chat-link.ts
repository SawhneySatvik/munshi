// A member's chat account. A signed-in member is shown a one-time code and posts it from their chat account, which ties
// the account Switch names to the session that asked. The code is kept only as sha256, is single use and lives 30 minutes (ops.chat_link, whose guard holds these rules again). Session
// lookups from a linked account are session.ts's chatSession: only that module makes a Session.
import { createHash, randomInt } from 'node:crypto';
import type pg from 'pg';
import { CoreError } from './errors.ts';
import { type Session, withTx } from './session.ts';

// Digits and capitals without the letters people misread on a phone. Eight of them make a code too long to guess.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 8;
const CHANNEL = /^[a-z0-9_-]{1,32}$/;

export type ChatCode = { code: string; expiresAt: Date };
export type ChatLink = { id: string; channel: string; linkedAt: Date; expiresAt: Date };
export type WaitingDraft = { id: string; command: string };

/** The code as it is stored, from what a person typed; null when `text` cannot be one. */
export function chatCodeOf(text: string): string | null {
  const raw = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return raw.length === LENGTH && [...raw].every((ch) => ALPHABET.includes(ch)) ? raw : null;
}

const hashOf = (code: string) => createHash('sha256').update(code).digest('hex');

/**
 * A one-time code for the signed-in member, carrying their session's via and identity epoch. Only a session a cookie
 * names can ask: a chat session cannot make itself another link. Any unused code of theirs is withdrawn.
 */
export async function issueChatCode(pool: pg.Pool, session: Session): Promise<ChatCode> {
  if (!session.sessionId) throw new CoreError('refused');
  const raw = Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return withTx(pool, { kind: 'member', session }, async (c) => {
    await c.query('update ops.chat_link set revoked_at = now() where member_id = $1 and linked_at is null and revoked_at is null', [session.memberId]);
    const { rows } = await c.query<{ expires_at: Date }>(
      `insert into ops.chat_link (tenant_id, member_id, via, subject_epoch, code_hash, expires_at)
       select s.tenant_id, s.member_id, s.via, s.subject_epoch, $2, now() + interval '30 minutes'
         from ops.login_session s where s.id = $1 and s.member_id = $3 and s.revoked_at is null and s.expires_at > now()
       returning expires_at`,
      [session.sessionId, hashOf(raw), session.memberId],
    );
    const row = rows[0];
    if (!row) throw new CoreError('refused');
    return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt: row.expires_at };
  });
}

/**
 * Binds the chat account that posted `text` to the member the code was shown to; true when it did. A wrong, used or
 * lapsed code changes nothing, and neither does a code from an account with a live link: an account stands for one
 * member at a time, so the old link is revoked in the app first. A lapsed link no longer holds its account.
 */
export async function linkChat(pool: pg.Pool, tenantId: string, channel: string, senderRef: string, text: string): Promise<boolean> {
  const code = chatCodeOf(text);
  if (!code || !CHANNEL.test(channel) || !senderRef) return false;
  return withTx(pool, { kind: 'system', tenantId }, async (c) => {
    await c.query('update ops.chat_link set revoked_at = now() where channel = $1 and sender_ref = $2 and revoked_at is null and expires_at <= now()', [channel, senderRef]);
    const held = await c.query('select 1 from ops.chat_link where channel = $1 and sender_ref = $2 and revoked_at is null', [channel, senderRef]);
    if (held.rows.length) return false;
    const { rowCount } = await c.query(
      `update ops.chat_link set channel = $1, sender_ref = $2
        where code_hash = $3 and linked_at is null and revoked_at is null and expires_at > now()`,
      [channel, senderRef, hashOf(code)],
    );
    return rowCount === 1;
  });
}

/** The member's live links, for the page that shows them. */
export async function chatLinksOf(pool: pg.Pool, session: Session): Promise<ChatLink[]> {
  const { rows } = await withTx(pool, { kind: 'member', session }, (c) =>
    c.query<{ id: string; channel: string; linked_at: Date; expires_at: Date }>(
      `select id::text, channel, linked_at, expires_at from ops.chat_link
        where member_id = $1 and linked_at is not null and revoked_at is null and expires_at > now() order by linked_at desc`,
      [session.memberId],
    ),
  );
  return rows.map((r) => ({ id: r.id, channel: r.channel, linkedAt: r.linked_at, expiresAt: r.expires_at }));
}

/** The member ends one of their own links. */
export async function revokeChatLink(pool: pg.Pool, session: Session, id: string): Promise<void> {
  await withTx(pool, { kind: 'member', session }, (c) =>
    c.query('update ops.chat_link set revoked_at = now() where id = $1 and member_id = $2 and revoked_at is null', [id, session.memberId]),
  );
}

/**
 * The draft still waiting that a chat message names, by the last six characters of its id (the random end of a
 * uuidv7). Null unless exactly one matches: a decision never lands on a guess.
 */
export async function waitingDraftByTail(pool: pg.Pool, session: Session, tail: string): Promise<WaitingDraft | null> {
  if (!/^[0-9a-f]{6}$/.test(tail)) return null;
  const { rows } = await withTx(pool, { kind: 'member', session }, (c) =>
    c.query<WaitingDraft>(`select id::text, command from approval.draft where status = 'proposed' and right(id::text, 6) = $1`, [tail]),
  );
  return rows.length === 1 ? (rows[0] as WaitingDraft) : null;
}
