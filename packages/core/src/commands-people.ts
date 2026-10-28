// Commands for contacts and staff. Type-only import: commands.ts spreads PEOPLE_COMMANDS while it is still being evaluated.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CommandResult, Ctx, Def } from './commands.ts';

const id = z.guid();
const minor = z.number().int().safe();
const day = z.iso.date();
const name = z.string().trim().min(1).max(120);

const customerCreate = z.strictObject({ name, phone: z.string().max(20).optional(), creditLimitMinor: minor.nonnegative().optional() });
const staffCreate = z.strictObject({
  name,
  phone: z.string().max(20).optional(),
  memberId: id.optional(),
  dailyWageMinor: minor.nonnegative().optional(),
  joinedOn: day.optional(),
});

function def<S extends z.ZodType>(input: S, run: (ctx: Ctx, input: z.output<S>) => Promise<CommandResult>): Def {
  return { input, run: run as Def['run'] };
}

export const PEOPLE_COMMANDS: [string, Def][] = [
  [
    'customer.create',
    def(customerCreate, async ({ c, t }, i) => {
      const customerId = randomUUID();
      const limit = i.creditLimitMinor;
      await c.query('insert into books.customer (tenant_id, id, name, phone, credit_limit_minor, currency) values ($1, $2, $3, $4, $5, $6)', [
        t.tenantId,
        customerId,
        i.name,
        i.phone ?? null,
        limit ?? null,
        limit === undefined ? null : t.currency,
      ]);
      return { customerId };
    }),
  ],
  [
    'staff.create',
    def(staffCreate, async ({ c, t }, i) => {
      const staffId = randomUUID();
      const wage = i.dailyWageMinor;
      await c.query(
        `insert into books.staff (tenant_id, id, name, phone, member_id, daily_wage_minor, currency, joined_on)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [t.tenantId, staffId, i.name, i.phone ?? null, i.memberId ?? null, wage ?? null, wage === undefined ? null : t.currency, i.joinedOn ?? null],
      );
      return { staffId };
    }),
  ],
];
