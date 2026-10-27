// G12 (ruling (b)): who may add a member. A tenant's first member is an active owner adding themself; after that only an
// active owner adds an owner or a manager, and an active owner or manager adds staff; every addition is audited under
// the member who made it. The acting member is the app's (set once, from the session).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, refused, type TestDb, tx } from './db.ts';
import { seedTenant, type Tenant } from './fixture.ts';

let db: TestDb;
let a: Tenant;
let b: Tenant;
beforeAll(async () => {
  db = await openTestDb();
  a = await seedTenant(db.app, 'A');
  b = await seedTenant(db.app, 'B');
  await db.sabotage();
});
afterAll(() => db.close());

const add = (t: Tenant, actor: string | undefined, role: string, id = randomUUID(), active = true) =>
  tx(db.app, actor ? { tenant: t.tenant, actor } : { tenant: t.tenant }, (c) =>
    c.query('insert into ops.member (tenant_id, id, name, role, active) values ($1, $2, $3, $4, $5) returning id', [t.tenant, id, `New ${role}`, role, active]),
  );
const signUp = (tenant: string, actor: string | undefined, id: string, role = 'owner') =>
  tx(db.app, actor ? { tenant, actor } : { tenant }, async (c) => {
    await c.query(`insert into ops.tenant (tenant_id, name) values ($1, 'New General Store (synthetic)')`, [tenant]);
    await c.query(`insert into ops.member (tenant_id, id, name, role) values ($1, $2, 'Founder', $3)`, [tenant, id, role]);
  });
const OWNER_ONLY = { code: 'MS007', message: 'member refused: an owner or manager is added by an active owner, staff by an active owner or manager' };
const FIRST = { code: 'MS007', message: "member refused: a tenant's first member is an active owner adding themself" };

it("G12 a tenant's first member is an owner adding themself", async () => {
  const founder = randomUUID();
  expect(await refused(signUp(randomUUID(), founder, founder, 'staff'))).toEqual(FIRST);
  expect(await refused(signUp(randomUUID(), randomUUID(), founder))).toEqual(FIRST); // someone else's session
  expect(await refused(signUp(randomUUID(), undefined, founder))).toEqual(FIRST);
  const tenant = randomUUID();
  await signUp(tenant, founder, founder);
  const { rows } = await db.admin.query('select role, active from ops.member where tenant_id = $1', [tenant]);
  expect(rows).toEqual([{ role: 'owner', active: true }]);
});

it('G12 only an active owner adds an owner or a manager', async () => {
  const gone = randomUUID();
  await add(a, a.owner, 'owner', gone, false);
  for (const [by, role] of [
    [a.manager, 'owner'],
    [a.manager, 'manager'],
    [a.staffMember, 'owner'],
    [a.staffMember, 'manager'],
    [gone, 'manager'],
    [undefined, 'manager'],
    [b.owner, 'manager'], // an owner of another tenant
  ] as const) {
    expect(await refused(add(a, by, role)), `${by} adding ${role}`).toEqual(OWNER_ONLY);
  }
  expect((await add(a, a.owner, 'manager')).rowCount).toBe(1);
  expect((await add(a, a.owner, 'owner')).rowCount).toBe(1);
});

it('G12 staff are added by an active owner or manager', async () => {
  expect(await refused(add(a, a.staffMember, 'staff'))).toEqual(OWNER_ONLY);
  expect((await add(a, a.manager, 'staff')).rowCount).toBe(1);
  expect((await add(a, a.owner, 'staff')).rowCount).toBe(1);
});

it('G12 every member added is audited under the member who added them', async () => {
  const id = randomUUID();
  await add(b, b.manager, 'staff', id);
  const entry = await db.admin.query('select actor_id, action from audit.audit_log where tenant_id = $1 and entity = $2 and entity_id = $3', [
    b.tenant,
    'ops.member',
    id,
  ]);
  expect(entry.rows).toEqual([{ actor_id: b.manager, action: 'member.add' }]);
  // Each of the fixture's three members, and the owner's own sign-up entry names the owner.
  const fixture = await db.admin.query(
    `select m.role, a.actor_id from ops.member m join audit.audit_log a on a.tenant_id = m.tenant_id and a.entity = 'ops.member' and a.entity_id = m.id
      where m.tenant_id = $1 and m.id = any($2::uuid[]) order by m.role`,
    [b.tenant, [b.owner, b.manager, b.staffMember]],
  );
  expect(fixture.rows).toEqual([
    { role: 'manager', actor_id: b.owner },
    { role: 'owner', actor_id: b.owner },
    { role: 'staff', actor_id: b.owner },
  ]);
  const chain = await tx(db.app, { tenant: b.tenant }, (c) => c.query('select audit.verify_chain($1) as broken', [b.tenant]));
  expect(chain.rows[0].broken).toBeNull();
});
