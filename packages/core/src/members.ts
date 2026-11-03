// Tenants and members (operational rows, not books). Who may add whom is enforced by ops.member_guard: the first
// member is the owner signing up as themself; then an owner adds owners and managers, an owner or manager adds staff.
// Each addition is audited by the database. A member's own name and phone live on ops.member (the people a shop serves
// live in the contact vault).
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { CoreError } from './errors.ts';
import { type Session, signUpSession, withTx } from './session.ts';
import { DEFAULT_TIME_ZONE } from './time.ts';

const person = z.string().trim().min(1).max(80);
const phone = z.string().regex(/^\+[1-9][0-9]{7,14}$/);
const signUp = z.strictObject({
  // The sign-up's kind decides the tenant's class, never the deployment (real and sample shops share one database): a
  // real shop is 'live' (pending until the operator accepts it), a sample one 'synthetic'. A visitor's sample shop is a
  // sandbox and has its own path (createSandbox); on a hosted or live database the app may make no other sample shop
  // (tenant_class, MS010).
  kind: z.enum(['real', 'sample']),
  name: z.string().trim().min(1).max(120),
  slug: z.string().regex(/^[a-z][a-z0-9-]{2,39}$/),
  businessType: z.enum(['kirana', 'apparel', 'salon']).default('kirana'),
  shopName: person,
  area: person.optional(), // the shop's city or locality
  ownerName: person,
  ownerPhone: phone.optional(),
  // The verified identity the owner signed up with (the identity adapter's subject), bound as the first-owner login.
  identity: z.strictObject({ provider: z.enum(['password', 'supabase']), subject: z.string().min(1).max(128) }),
  currency: z.string().regex(/^[A-Z]{3}$/).default('INR'),
  timeZone: z.string().min(1).max(64).default(DEFAULT_TIME_ZONE),
});
const newMember = z.strictObject({ name: person, role: z.enum(['owner', 'manager', 'staff']), phone: phone.optional() });

function parse<S extends z.ZodType>(s: S, input: unknown): z.output<S> {
  const r = s.safeParse(input);
  if (!r.success) throw new CoreError('invalid', { fields: r.error.issues.map((i) => i.path.join('.') || '(input)') });
  return r.data;
}

// Sign-up: one transaction as the new owner, in the order the triggers need. The tenant first (it stamps the
// transaction that created it); the directory row and the owner member are admitted only in that transaction; the
// first-owner login only while the owner is its one member; the shop only from an active owner. The data class follows
// the sign-up's kind. Last, the chosen pack's capability switches: after the owner's member row, since capability_guard
// takes a switch with an actor only from an active owner (so each is the owner's own, audited), and requirements first,
// since a switch-on needs every capability it requires on (ref.capability_requires is one level deep).
export async function createTenant(pool: pg.Pool, input: z.input<typeof signUp>): Promise<{ session: Session; shopId: string }> {
  const i = parse(signUp, input);
  const session = signUpSession();
  const shopId = randomUUID();
  await withTx(pool, { kind: 'member', session }, async (c) => {
    await c.query(
      `insert into ops.tenant (tenant_id, name, business_type, data_class, currency, time_zone)
       values ($1, $2, $3, $4, $5, $6)`,
      [session.tenantId, i.name, i.businessType, i.kind === 'real' ? 'live' : 'synthetic', i.currency, i.timeZone],
    );
    await c.query('insert into ops.tenant_directory (slug, tenant_id) values ($1, $2)', [i.slug, session.tenantId]);
    await c.query(`insert into ops.member (tenant_id, id, display_name, phone_e164, role) values ($1, $2, $3, $4, 'owner')`, [
      session.tenantId,
      session.memberId,
      i.ownerName,
      i.ownerPhone ?? null,
    ]);
    await c.query('insert into ops.login (provider, subject, tenant_id, member_id, first_owner) values ($1, $2, $3, $4, true)', [
      i.identity.provider,
      i.identity.subject,
      session.tenantId,
      session.memberId,
    ]);
    await c.query('insert into ops.shop (tenant_id, id, name, area) values ($1, $2, $3, $4)', [session.tenantId, shopId, i.shopName, i.area ?? null]);
    await c.query(
      `insert into ops.capability_switch (tenant_id, capability, is_on)
       select $1, p.capability, true from ref.pack_capability p where p.business_type = $2
        order by exists (select 1 from ref.capability_requires r where r.capability = p.capability), p.capability`,
      [session.tenantId, i.businessType],
    );
  });
  return { session, shopId };
}

export async function addMember(pool: pg.Pool, session: Session, input: z.input<typeof newMember>): Promise<string> {
  const i = parse(newMember, input);
  const memberId = randomUUID();
  await withTx(pool, { kind: 'member', session }, (c) =>
    c.query('insert into ops.member (tenant_id, id, display_name, phone_e164, role) values ($1, $2, $3, $4, $5)', [
      session.tenantId,
      memberId,
      i.name,
      i.phone ?? null,
      i.role,
    ]),
  );
  return memberId;
}
