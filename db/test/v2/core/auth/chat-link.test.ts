// A chat account stands for a member (27_chat_link.sql, core's chat-link.ts and chatSession): CHAT1 (only the member
// sees the code, and the account that posts it becomes theirs), CHAT2 (a code works once, never after it lapses, and
// never from an account with a live link), CHAT3 (a link never moves, and is opened only by its own member), CHAT4 (a
// revoked, lapsed or deactivated link is no session), CHAT5 (another shop's link is neither read nor used), CHAT6 (an
// erased member's account goes with them), CHAT7 (a link's via follows the session that asked for it, so a sample link
// is never a session on a real shop), CHAT8 (a decision from chat runs as the linked member, and the database still
// refuses one who may not approve). Red-proofs: test/v2/sabotage/chat-link.ts.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chatCodeOf, chatLinksOf, issueChatCode, linkChat, revokeChatLink } from '../../../../../packages/core/src/chat-link.ts';
import { chatSession, type Session, startSession, withTx } from '../../../../../packages/core/src/session.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { signUp, type Tenant } from '../../gates/fixture.ts';
import { refused } from '../../gates/lib.ts';

let db: TestDb;
let t: Tenant;
let other: Tenant;
let owner: Session;
let staff: Session;
let n = 0;

const account = () => `tg-${++n}`;
const app = () => db.as('munshi_app');

beforeAll(async () => {
  db = await openTestDb();
  await db.sabotage();
  t = await signUp(db, 'chat-shop');
  other = await signUp(db, 'chat-other');
  owner = (await startSession(app(), t.tenant, t.owner, 'demo')).session;
  staff = (await startSession(app(), t.tenant, t.staff, 'demo')).session;
});
afterAll(() => db?.close());

const linked = async (who: Session = staff) => {
  const sender = account();
  const { code } = await issueChatCode(app(), who);
  expect(await linkChat(app(), who.tenantId, 'telegram', sender, code)).toBe(true);
  return sender;
};

it('CHAT1 the account that posts a member’s code becomes that member, and nobody before it', async () => {
  const sender = account();
  expect(await chatSession(app(), t.tenant, 'telegram', sender)).toBeNull();
  const { code } = await issueChatCode(app(), staff);
  expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  expect(await chatSession(app(), t.tenant, 'telegram', sender)).toBeNull();
  expect(await linkChat(app(), t.tenant, 'telegram', sender, code.toLowerCase())).toBe(true);
  const session = await chatSession(app(), t.tenant, 'telegram', sender);
  expect(session).toMatchObject({ tenantId: t.tenant, memberId: t.staff, via: 'demo' });
  expect(await chatSession(app(), t.tenant, 'whatsapp', sender)).toBeNull();
  // Only the code's hash is kept.
  const { rows } = await db.admin.query(`select code_hash from ops.chat_link where sender_ref = $1`, [sender]);
  expect(rows).toEqual([{ code_hash: null }]);
});

it('CHAT1 a chat session cannot ask for another code: only a signed-in session can', async () => {
  const session = (await chatSession(app(), t.tenant, 'telegram', await linked())) as Session;
  await expect(issueChatCode(app(), session)).rejects.toMatchObject({ code: 'refused' });
});

it('CHAT2 a code works once, not after it lapses, and not from an account with a live link', async () => {
  const { code } = await issueChatCode(app(), staff);
  expect(await linkChat(app(), t.tenant, 'telegram', account(), code)).toBe(true);
  expect(await linkChat(app(), t.tenant, 'telegram', account(), code)).toBe(false);
  expect(await linkChat(app(), t.tenant, 'telegram', account(), 'ZZZZ-ZZZZ')).toBe(false);
  expect(chatCodeOf('nope')).toBeNull();
  expect(chatCodeOf('o1l0-ab2c')).toBe('0110AB2C');

  const lapsed = await issueChatCode(app(), staff);
  await db.admin.query(`alter table ops.chat_link disable trigger guard`);
  await db.admin.query(`update ops.chat_link set created_at = now() - interval '1 hour', expires_at = now() - interval '1 minute' where linked_at is null and revoked_at is null`);
  await db.admin.query(`alter table ops.chat_link enable trigger guard`);
  expect(await linkChat(app(), t.tenant, 'telegram', account(), lapsed.code)).toBe(false);

  const sender = await linked(staff);
  const again = await issueChatCode(app(), owner);
  expect(await linkChat(app(), t.tenant, 'telegram', sender, again.code)).toBe(false);
  expect(await chatSession(app(), t.tenant, 'telegram', sender)).toMatchObject({ memberId: t.staff });
});

it('CHAT3 a member opens only their own link, with a code, and a linked account never moves', async () => {
  const insert = (actor: string, member: string, extra = '') =>
    tx(app(), { tenant_id: t.tenant, actor_id: actor }, (c) =>
      c.query(`insert into ops.chat_link (tenant_id, member_id, via, code_hash, expires_at${extra ? ', sender_ref, channel' : ''})
               values ($1, $2, 'demo', repeat('a', 64), now() + interval '5 minutes'${extra})`, [t.tenant, member]),
    );
  expect((await refused(insert(t.staff, t.owner))).code).toBe('MS007');
  expect((await refused(insert(t.staff, t.staff, `, 'forged', 'telegram'`))).code).toBe('MS007');
  const long = tx(app(), { tenant_id: t.tenant, actor_id: t.staff }, (c) =>
    c.query(`insert into ops.chat_link (tenant_id, member_id, via, code_hash, expires_at) values ($1, $2, 'demo', repeat('b', 64), now() + interval '1 day')`, [t.tenant, t.staff]),
  );
  expect((await refused(long)).code).toBe('MS007');

  const sender = await linked(staff);
  const move = tx(app(), { tenant_id: t.tenant }, (c) => c.query(`update ops.chat_link set sender_ref = 'stolen' where sender_ref = $1`, [sender]));
  expect((await refused(move)).code).toBe('MS007');
  const widen = tx(app(), { tenant_id: t.tenant }, (c) => c.query(`update ops.chat_link set member_id = $2 where sender_ref = $1`, [sender, t.owner]));
  expect((await refused(widen)).code).toBe('42501');
});

it('CHAT4 a revoked or lapsed link is no session, and a deactivated member loses every link', async () => {
  const sender = await linked(staff);
  const [link] = (await chatLinksOf(app(), staff)).filter((l) => l.channel === 'telegram');
  expect(link).toBeDefined();
  const mine = await db.admin.query<{ id: string }>('select id::text from ops.chat_link where sender_ref = $1', [sender]);
  await revokeChatLink(app(), staff, mine.rows[0]?.id as string);
  expect(await chatSession(app(), t.tenant, 'telegram', sender)).toBeNull();

  const stranger = tx(app(), { tenant_id: t.tenant }, (c) => c.query(`update ops.chat_link set revoked_at = now() where sender_ref = 'none' or revoked_at is null and linked_at is not null`));
  expect((await refused(stranger)).code).toBe('MS007');

  const lapsing = await linked(staff);
  await db.admin.query(`alter table ops.chat_link disable trigger guard`);
  await db.admin.query(`update ops.chat_link set created_at = now() - interval '20 days', expires_at = now() - interval '1 day' where sender_ref = $1`, [lapsing]);
  await db.admin.query(`alter table ops.chat_link enable trigger guard`);
  expect(await chatSession(app(), t.tenant, 'telegram', lapsing)).toBeNull();
  // The lapsed link no longer holds its account.
  const { code } = await issueChatCode(app(), staff);
  expect(await linkChat(app(), t.tenant, 'telegram', lapsing, code)).toBe(true);

  const shop = await signUp(db, 'chat-leaver');
  const leaver = (await startSession(app(), shop.tenant, shop.staff, 'demo')).session;
  const gone = await linked(leaver);
  await tx(app(), { tenant_id: shop.tenant, actor_id: shop.owner }, (c) => c.query('update ops.member set active = false, deactivated_at = now() where id = $1', [shop.staff]));
  expect(await chatSession(app(), shop.tenant, 'telegram', gone)).toBeNull();
  const { rows } = await db.admin.query('select revoked_at is not null as revoked from ops.chat_link where sender_ref = $1', [gone]);
  expect(rows).toEqual([{ revoked: true }]);
});

it('CHAT5 another shop neither reads nor uses a link, and neither does the agent role', async () => {
  const sender = await linked(staff);
  expect(await chatSession(app(), other.tenant, 'telegram', sender)).toBeNull();
  const seen = await tx(app(), { tenant_id: other.tenant }, (c) => c.query('select 1 from ops.chat_link where sender_ref = $1', [sender]));
  expect(seen.rows).toEqual([]);
  const { code } = await issueChatCode(app(), staff);
  expect(await linkChat(app(), other.tenant, 'telegram', account(), code)).toBe(false);
  expect((await refused(tx(db.as('munshi_agent'), { tenant_id: t.tenant }, (c) => c.query('select 1 from ops.chat_link')))).code).toBe('42501');
});

it('CHAT6 an erased member’s chat account is erased with them, and only with them', async () => {
  const shop = await signUp(db, 'chat-erased');
  const leaver = (await startSession(app(), shop.tenant, shop.staff, 'demo')).session;
  const sender = await linked(leaver);
  const direct = tx(app(), { tenant_id: shop.tenant, actor_id: shop.owner }, (c) => c.query(`update ops.chat_link set sender_ref = null, erased_at = now() where sender_ref = $1`, [sender]));
  expect((await refused(direct)).code).toBe('MS007');
  await tx(app(), { tenant_id: shop.tenant, actor_id: shop.owner }, (c) => c.query('update ops.member set active = false, deactivated_at = now() where id = $1 and active', [shop.staff]));
  await tx(app(), { tenant_id: shop.tenant, actor_id: shop.owner }, (c) => c.query('update ops.member set display_name = null, phone_e164 = null, erased_at = now() where id = $1', [shop.staff]));
  const { rows } = await db.admin.query('select sender_ref, erased_at is not null as erased from ops.chat_link where tenant_id = $1 and member_id = $2 and linked_at is not null', [shop.tenant, shop.staff]);
  expect(rows).toEqual([{ sender_ref: null, erased: true }]);
});

it('CHAT7 a link carries its session’s via, and a sample link is never a session on a real shop', async () => {
  const sender = await linked(owner);
  expect(await chatSession(app(), t.tenant, 'telegram', sender)).toMatchObject({ via: 'demo' });
  await db.admin.query(`alter table ops.tenant disable trigger user`);
  await db.admin.query(`update ops.tenant set data_class = 'live' where tenant_id = $1`, [t.tenant]);
  const live = await chatSession(app(), t.tenant, 'telegram', sender);
  await db.admin.query(`update ops.tenant set data_class = 'synthetic' where tenant_id = $1`, [t.tenant]);
  await db.admin.query(`alter table ops.tenant enable trigger user`);
  expect(live).toBeNull();
});

it('CHAT8 the session names the linked member, so the acting member in the database is theirs', async () => {
  const session = (await chatSession(app(), t.tenant, 'telegram', await linked(owner))) as Session;
  const { rows } = await withTx(app(), { kind: 'member', session }, (c) =>
    c.query<{ actor: string; via: string }>(`select current_setting('munshi.actor_id') as actor, current_setting('munshi.via') as via`),
  );
  expect(rows).toEqual([{ actor: t.owner, via: 'demo' }]);
});
