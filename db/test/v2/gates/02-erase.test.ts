// OE1: ops.only_erase and ops.fill_once (02), every exploit path. only_erase is driven through ops.contact; fill_once has
// no table in files 00–09 (the inbound transcript lands in 19), so a probe table carries it here. Red-proofs:
// test/v2/sabotage/erase.ts.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { signUp, type Tenant } from './fixture.ts';
import { refused } from './lib.ts';

let db: TestDb;
let t: Tenant;

// Each erasable table of files 00–15 and the columns its `erase` trigger lists (§2.6: personal and identity columns).
const ERASABLE: Record<string, string[]> = {
  'ops.member': ['display_name', 'phone_e164'],
  'ops.member_invite': ['email'],
  'ops.login': ['subject'],
  'ops.contact': ['name', 'phone_e164'],
  'ops.document': ['storage_key'],
  'ops.message_text': ['body'],
  'ops.staff_public': ['display_name', 'blurb'],
  'ops.site_request': ['contact_name', 'contact_phone_e164', 'note', 'ip_hash'],
  'ops.booking_contact': ['contact_name', 'contact_phone_e164', 'note', 'ip_hash'],
  'ops.reservation': ['contact_name', 'contact_phone_e164', 'note', 'ip_hash'],
};

beforeAll(async () => {
  db = await openTestDb();
  t = await signUp(db, 'erase-shop');
  await db.admin.query(`
    set role munshi_owner;
    create table ops.fill_probe (
      tenant_id uuid not null, id uuid primary key default ops.uuidv7(), name text, transcript text, transcribed_at timestamptz, erased_at timestamptz);
    create trigger erase before update on ops.fill_probe for each row execute function ops.only_erase('name');
    create trigger fill_transcript before update on ops.fill_probe for each row execute function ops.fill_once('transcript', 'transcribed_at');
    grant select, insert, update on ops.fill_probe to munshi_app;
    reset role;`);
  await db.sabotage();
});
afterAll(() => db?.close());

const app = () => db.as('munshi_app');
const owner = () => ({ tenant_id: t.tenant, actor_id: t.owner });

async function contact(phone: string): Promise<string> {
  return tx(app(), owner(), async (c) => {
    const r = await c.query<{ id: string }>(`insert into ops.contact (tenant_id, name, phone_e164) values ($1, 'Ravi', $2) returning id`, [t.tenant, phone]);
    return r.rows[0]?.id as string;
  });
}
const update = (id: string, set: string) =>
  tx(app(), owner(), (c) => c.query(`update ops.contact set ${set} where tenant_id = $1 and id = $2`, [t.tenant, id]));
const ERASE = `name = null, phone_e164 = null, erased_at = now(), erased_by = '{owner}', erase_reason = 'request'`;

it('OE1 an erasure nulls every personal column with erased_at = now() in one UPDATE, and the erased row never changes again', async () => {
  const id = await contact('+919811000001');
  const erase = ERASE.replace('{owner}', t.owner);
  const exploits: [string, string][] = [
    ['change a personal column', `name = 'Somebody else'`],
    ['null a personal column without erasing', 'phone_e164 = null'],
    ['erase, leaving one personal column', erase.replace('phone_e164 = null, ', '')],
    ['erase at a time that is not now()', erase.replace('erased_at = now()', `erased_at = now() - interval '1 day'`)],
  ];
  for (const [what, set] of exploits) {
    expect((await refused(update(id, set))).code, what).toBe('MS011');
  }
  await update(id, erase);
  const frozen: [string, string][] = [
    ['un-erase', 'erased_at = null'],
    ['refill a personal column', `name = 'Ravi'`],
    ['touch any other column', 'erase_requested_at = now()'],
  ];
  for (const [what, set] of frozen) {
    expect((await refused(update(id, set))).code, what).toBe('MS011');
  }
  const { rows } = await db.admin.query('select name, phone_e164, erased_at is not null as erased from ops.contact where id = $1', [id]);
  expect(rows).toEqual([{ name: null, phone_e164: null, erased: true }]);
});

it('OE1 a NULL personal column is never filled: a changed phone is a new contact', async () => {
  const id = await tx(app(), owner(), async (c) => {
    const r = await c.query<{ id: string }>(`insert into ops.contact (tenant_id, name) values ($1, 'No phone') returning id`, [t.tenant]);
    return r.rows[0]?.id as string;
  });
  expect((await refused(update(id, `phone_e164 = '+919811000002'`))).code).toBe('MS011');
});

it('OE1 a fill-once column fills once, in the UPDATE that sets its stamp, never again even after a NULL; an erasure still nulls it and freezes the row', async () => {
  const id = (
    await tx(app(), { tenant_id: t.tenant }, (c) => c.query<{ id: string }>(`insert into ops.fill_probe (tenant_id, name) values ($1, 'Asha') returning id`, [t.tenant]))
  ).rows[0]?.id as string;
  const set = (s: string) => tx(app(), { tenant_id: t.tenant }, (c) => c.query(`update ops.fill_probe set ${s} where id = $1`, [id]));
  const before: [string, string][] = [
    ['fill without the stamp', `transcript = 'hello'`],
    ['stamp without a fill', 'transcribed_at = now()'],
    ['fill at a time that is not now()', `transcript = 'hello', transcribed_at = now() - interval '1 hour'`],
  ];
  for (const [what, s] of before) expect((await refused(set(s))).code, what).toBe('MS011');
  await set(`transcript = 'hello', transcribed_at = now()`);
  const after: [string, string][] = [
    ['fill again', `transcript = 'changed'`],
    ['fill again with a fresh stamp', `transcript = 'changed', transcribed_at = now()`],
    ['clear the stamp', 'transcribed_at = null'],
    ['null it outside an erasure', 'transcript = null'],
    ['erase, leaving it', `name = null, erased_at = now()`],
  ];
  for (const [what, s] of after) expect((await refused(set(s))).code, what).toBe('MS011');
  await set(`name = null, transcript = null, erased_at = now()`);
  expect((await refused(set(`transcript = 'again', transcribed_at = now()`))).code).toBe('MS011');
});

it('OE1 every erasable table lists exactly its personal and identity columns in its erase trigger', async () => {
  const { rows } = await db.admin.query<{ rel: string; args: string }>(
    `select t.tgrelid::regclass::text as rel, encode(t.tgargs, 'escape') as args from pg_trigger t
      where t.tgname = 'erase' and t.tgfoid = 'ops.only_erase()'::regprocedure and t.tgrelid::regclass::text <> 'ops.fill_probe' order by 1`,
  );
  const found = Object.fromEntries(rows.map((r) => [r.rel, r.args.split('\\000').filter(Boolean)]));
  console.log(`OE1 ${rows.length} tables carry ops.only_erase; ${Object.keys(ERASABLE).length} expected`);
  expect(found).toEqual(ERASABLE);
});
