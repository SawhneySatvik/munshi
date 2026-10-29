// Commands for the people a shop deals with: customers, suppliers and staff. Each is an id in the books; the person's
// name and phone go into the contact vault (ops.contact) in the same transaction, and books.party_contact links the two,
// so no name or phone ever enters a book row (BLUEPRINT §2.6). Helpers from commands.ts are used only inside run(), so
// the value import is safe while commands.ts spreads this list.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { at, type CommandResult, type Ctx, type Def } from './commands.ts';
import { businessDate } from './time.ts';

const id = z.guid();
const minor = z.number().int().safe();
const day = z.iso.date();
const instant = z.iso.datetime({ offset: true });
const name = z.string().trim().min(1).max(80);
const phone = z.string().regex(/^\+[1-9][0-9]{7,14}$/);

// effectiveFrom: when the terms and the contact link take effect (now unless given: a seed back-dates its people).
const customerCreate = z.strictObject({ name, phone: phone.optional(), creditLimitMinor: minor.nonnegative().optional(), effectiveFrom: instant.optional() });
const supplierCreate = z.strictObject({ name, phone: phone.optional(), effectiveFrom: instant.optional() }); // every supplier is simulated
// A wage is set for a home branch from the day they joined (books.staff_terms).
const staffCreate = z
  .strictObject({
    name,
    phone: phone.optional(),
    memberId: id.optional(),
    shopId: id.optional(),
    dailyWageMinor: minor.nonnegative().optional(),
    joinedOn: day.optional(),
    effectiveFrom: instant.optional(),
  })
  .refine((i) => (i.dailyWageMinor === undefined) === (i.shopId === undefined), { path: ['shopId'] });

function def<S extends z.ZodType>(input: S, run: (ctx: Ctx, input: z.output<S>) => Promise<CommandResult>): Def {
  return { input, run: run as Def['run'] };
}

// The person in the vault, and the link naming them from a party row.
async function contact(ctx: Ctx, person: { name: string; phone?: string | undefined }): Promise<string> {
  const { rows } = await ctx.c.query<{ id: string }>('insert into ops.contact (tenant_id, name, phone_e164) values ($1, $2, $3) returning id', [
    ctx.t.tenantId,
    person.name,
    person.phone ?? null,
  ]);
  return (rows[0] as { id: string }).id;
}

async function link(ctx: Ctx, party: 'customer_id' | 'supplier_id' | 'staff_id', partyId: string, contactId: string, from: Date) {
  await ctx.c.query(`insert into books.party_contact (tenant_id, ${party}, contact_id, effective_from) values ($1, $2, $3, $4)`, [
    ctx.t.tenantId,
    partyId,
    contactId,
    from,
  ]);
}

export const PEOPLE_COMMANDS: [string, Def][] = [
  [
    'customer.create',
    def(customerCreate, async (ctx, i) => {
      const { c, t } = ctx;
      const from = at(i.effectiveFrom);
      const contactId = await contact(ctx, i);
      const customerId = randomUUID();
      await c.query('insert into books.customer (tenant_id, id) values ($1, $2)', [t.tenantId, customerId]);
      if (i.creditLimitMinor !== undefined) {
        await c.query('insert into books.customer_terms (tenant_id, customer_id, credit_limit_minor, currency, effective_from) values ($1, $2, $3, $4, $5)', [
          t.tenantId,
          customerId,
          i.creditLimitMinor,
          t.currency,
          from,
        ]);
      }
      await link(ctx, 'customer_id', customerId, contactId, from);
      return { customerId, contactId };
    }),
  ],
  [
    'supplier.create',
    def(supplierCreate, async (ctx, i) => {
      const contactId = await contact(ctx, i);
      const supplierId = randomUUID();
      await ctx.c.query('insert into books.supplier (tenant_id, id, is_simulated) values ($1, $2, true)', [ctx.t.tenantId, supplierId]);
      await link(ctx, 'supplier_id', supplierId, contactId, at(i.effectiveFrom));
      return { supplierId, contactId };
    }),
  ],
  [
    'staff.create',
    def(staffCreate, async (ctx, i) => {
      const { c, t } = ctx;
      const from = at(i.effectiveFrom);
      const contactId = await contact(ctx, i);
      const staffId = randomUUID();
      await c.query('insert into books.staff (tenant_id, id, member_id) values ($1, $2, $3)', [t.tenantId, staffId, i.memberId ?? null]);
      if (i.dailyWageMinor !== undefined) {
        await c.query(
          `insert into books.staff_terms (tenant_id, staff_id, shop_id, pay_kind, pay_minor, currency, effective_from)
           values ($1, $2, $3, 'daily', $4, $5, $6)`,
          [t.tenantId, staffId, i.shopId, i.dailyWageMinor, t.currency, i.joinedOn ?? businessDate(from, t.timeZone)],
        );
      }
      await link(ctx, 'staff_id', staffId, contactId, from);
      return { staffId, contactId };
    }),
  ],
];
