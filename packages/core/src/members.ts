// Tenants and members (operational rows, not books). Who may add whom is enforced by ops.member_guard (ruling (b)):
// the first member is the owner signing up as themself; then an owner adds owners and managers, an owner or manager
// adds staff. Each addition is audited by the database.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { CoreError } from './errors.ts';
import { type Session, signUpSession, withTx } from './session.ts';
import { DEFAULT_TIME_ZONE } from './time.ts';

const signUp = z.strictObject({
  name: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  ownerName: z.string().trim().min(1).max(120),
  ownerPhone: z.string().max(20).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).default('INR'),
  timeZone: z.string().min(1).max(64).default(DEFAULT_TIME_ZONE),
});
const newMember = z.strictObject({
  name: z.string().trim().min(1).max(120),
  role: z.enum(['owner', 'manager', 'staff']),
  phone: z.string().max(20).optional(),
});

function parse<S extends z.ZodType>(s: S, input: unknown): z.output<S> {
  const r = s.safeParse(input);
  if (!r.success) throw new CoreError('invalid', { fields: r.error.issues.map((i) => i.path.join('.') || '(input)') });
  return r.data;
}

// Sign-up: a new tenant, its first shop, and its owner, in the owner's own session (the session this returns).
export async function createTenant(pool: pg.Pool, input: z.input<typeof signUp>): Promise<{ session: Session; shopId: string }> {
  const i = parse(signUp, input);
  const session = signUpSession();
  const shopId = randomUUID();
  await withTx(pool, { kind: 'member', session }, async (c) => {
    await c.query('insert into ops.tenant (tenant_id, name, currency, time_zone) values ($1, $2, $3, $4)', [session.tenantId, i.name, i.currency, i.timeZone]);
    await c.query('insert into ops.shop (tenant_id, id, name) values ($1, $2, $3)', [session.tenantId, shopId, i.shopName]);
    await c.query(`insert into ops.member (tenant_id, id, name, phone, role) values ($1, $2, $3, $4, 'owner')`, [
      session.tenantId,
      session.memberId,
      i.ownerName,
      i.ownerPhone ?? null,
    ]);
  });
  return { session, shopId };
}

export async function addMember(pool: pg.Pool, session: Session, input: z.input<typeof newMember>): Promise<string> {
  const i = parse(newMember, input);
  const memberId = randomUUID();
  await withTx(pool, { kind: 'member', session }, (c) =>
    c.query('insert into ops.member (tenant_id, id, name, phone, role) values ($1, $2, $3, $4, $5)', [
      session.tenantId,
      memberId,
      i.name,
      i.phone ?? null,
      i.role,
    ]),
  );
  return memberId;
}
