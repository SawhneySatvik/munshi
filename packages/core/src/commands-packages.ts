// Commands for packages (BLUEPRINT §8.2): a plan (a package item, its price and its services' sessions), a session
// redeemed at any branch, and an expiry, which is draft-only, executes only on a lapsed holding and goes stale when a
// redemption lands first (P4: its draft cites package.balance, which approvals re-reads). A sale sells the holding (sale.record). The liability moves by
// the journal: a redemption takes the holding's remaining value ÷ its remaining sessions (integer paise, the last session
// the rest) from package_liability to sales; an expiry moves what is left to package_breakage. Balances are the
// database's (b_package_tally); a value plan (stored value) is not built yet. Helpers from commands.ts are used only
// inside run(), so the value import is safe while commands.ts spreads PACKAGE_COMMANDS.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { at, type CommandResult, type Ctx, type Def, journal, one } from './commands.ts';
import { CoreError } from './errors.ts';
import { businessDate } from './time.ts';

const id = z.guid();
const instant = z.iso.datetime({ offset: true });

const planCreate = z.strictObject({
  name: z.string().trim().min(1).max(120),
  priceMinor: z.number().int().safe().nonnegative(),
  validityDays: z.number().int().min(1).max(1095),
  lines: z
    .array(z.strictObject({ itemId: id, sessions: z.number().int().min(1).max(100) }))
    .min(1)
    .max(20)
    .refine((l) => new Set(l.map((x) => x.itemId)).size === l.length),
  category: z.string().trim().min(1).max(60).optional(),
  taxClass: z
    .string()
    .regex(/^[a-z0-9_]{2,40}$/)
    .optional(),
  hsnSac: z
    .string()
    .regex(/^[0-9]{4,8}$/)
    .optional(),
  effectiveFrom: instant.optional(),
});
const redeem = z.strictObject({ holdingId: id, shopId: id, itemId: id });
const expire = z.strictObject({ holdingId: id });

function def<S extends z.ZodType>(input: S, run: (ctx: Ctx, input: z.output<S>) => Promise<CommandResult>): Def {
  return { input, run: run as Def['run'] };
}

// The holding's lock, taken before its balances are read, in b_package_tally's order (the chain lock first, 02's lock
// classes), so two redemptions never price a session off the same balance.
async function lockHolding(ctx: Ctx, holdingId: string) {
  await ctx.c.query('select pg_advisory_xact_lock(1, hashtext($1::uuid::text))', [ctx.t.tenantId]);
  await ctx.c.query('select pg_advisory_xact_lock(4, hashtext($1::uuid::text || $2::uuid::text))', [ctx.t.tenantId, holdingId]);
}

// What a holding has left: its value (the last entry's value_after) and each service's sessions (its last entry's).
type Left = { value: number; items: { item_id: string; sessions: number }[] };
async function holdingLeft(c: pg.PoolClient, holdingId: string): Promise<Left> {
  const r = await one<{ value: string; items: { item_id: string; sessions: number }[] }>(
    c,
    `select coalesce((select e.value_after from books.package_entry e where e.tenant_id = h.tenant_id and e.holding_id = h.id order by e.seq desc limit 1), 0) as value,
            coalesce((select json_agg(json_build_object('item_id', x.item_id, 'sessions', x.sessions_after) order by x.item_id)
                        from (select distinct on (e.item_id) e.item_id, e.sessions_after from books.package_entry e
                               where e.tenant_id = h.tenant_id and e.holding_id = h.id and e.item_id is not null
                               order by e.item_id, e.seq desc) x), '[]') as items
       from books.package_holding h where h.id = $1`,
    [holdingId],
  );
  return { value: Number(r.value), items: r.items };
}

export const PACKAGE_COMMANDS: [string, Def][] = [
  [
    // A plan: its package item (with its name and tax codes in a first revision) and price, and its services' sessions.
    'package.plan.create',
    def(planCreate, async ({ c, t }, i) => {
      const from = at(i.effectiveFrom);
      const itemId = randomUUID();
      const priceId = randomUUID();
      const planId = randomUUID();
      await c.query(`insert into books.item (tenant_id, id, kind, unit) values ($1, $2, 'package', 'piece')`, [t.tenantId, itemId]);
      await c.query(
        'insert into books.item_revision (tenant_id, item_id, name, category, tax_class, hsn_sac, effective_from) values ($1, $2, $3, $4, $5, $6, $7)',
        [t.tenantId, itemId, i.name, i.category ?? null, i.taxClass ?? null, i.hsnSac ?? null, from],
      );
      await c.query('insert into books.price (tenant_id, id, item_id, amount_minor, currency, effective_from) values ($1, $2, $3, $4, $5, $6)', [
        t.tenantId,
        priceId,
        itemId,
        i.priceMinor,
        t.currency,
        from,
      ]);
      await c.query(`insert into books.package_plan (tenant_id, id, item_id, kind, validity_days) values ($1, $2, $3, 'sessions', $4)`, [
        t.tenantId,
        planId,
        itemId,
        i.validityDays,
      ]);
      await c.query(
        `insert into books.package_plan_line (tenant_id, plan_id, line_no, item_id, sessions)
         select $1, $2, l.n, l.item, l.sessions from unnest($3::int[], $4::uuid[], $5::int[]) as l(n, item, sessions)`,
        [t.tenantId, planId, i.lines.map((_, k) => k + 1), i.lines.map((l) => l.itemId), i.lines.map((l) => l.sessions)],
      );
      return { itemId, priceId, planId };
    }),
  ],
  [
    // One session of a service from a holding, at the branch it was used in.
    'package.redeem',
    def(redeem, async (ctx, i) => {
      const { c, t } = ctx;
      await lockHolding(ctx, i.holdingId);
      const left = await holdingLeft(c, i.holdingId);
      const sessions = left.items.reduce((a, x) => a + x.sessions, 0);
      const share = sessions <= 1 ? left.value : Math.floor(left.value / sessions);
      const entryId = randomUUID();
      const now = new Date();
      await c.query(
        `insert into books.package_entry (tenant_id, id, holding_id, shop_id, item_id, kind, sessions, value_minor, currency, at)
         values ($1, $2, $3, $4, $5, 'redeemed', -1, $6, $7, $8)`,
        [t.tenantId, entryId, i.holdingId, i.shopId, i.itemId, -share, t.currency, now],
      );
      await journal(ctx, businessDate(now, t.timeZone), 'package_redeemed', ['books.package_entry', entryId], [
        ['package_liability', share],
        ['sales', -share],
      ]);
      return { entryId };
    }),
  ],
  [
    // What a lapsed holding has left, written off as breakage: every service's remaining sessions and the whole value left.
    'package.expire',
    {
      input: expire,
      draftOnly: true,
      // A holding with something left. A draft may be proposed before the holding lapses (the reminder recipe's moment);
      // a redemption meanwhile changes the package.balance cell it cites, so approvals marks it stale (P4). It executes
      // only once the holding is past its expires_on in the shop's zone, when no redemption can land (b_package_tally).
      checks: async (c, payload) => {
        const left = await holdingLeft(c, (payload as z.output<typeof expire>).holdingId);
        return left.value > 0 || left.items.some((x) => x.sessions > 0) ? [] : ['holdingId'];
      },
      run: (async (ctx: Ctx, i: z.output<typeof expire>) => {
        const { c, t } = ctx;
        const { lapsed } = await one<{ lapsed: boolean }>(
          c,
          'select h.expires_on < (now() at time zone t.time_zone)::date as lapsed from books.package_holding h cross join ops.tenant t where h.id = $1',
          [i.holdingId],
        );
        if (!lapsed) throw new CoreError('invalid', { fields: ['holdingId'] });
        await lockHolding(ctx, i.holdingId);
        const left = await holdingLeft(c, i.holdingId);
        const now = new Date();
        const rows = left.items.filter((x) => x.sessions > 0).map((x) => ({ item: x.item_id as string | null, sessions: -x.sessions as number | null }));
        if (!rows.length) rows.push({ item: null, sessions: null });
        const ids = rows.map(() => randomUUID());
        await c.query(
          `insert into books.package_entry (tenant_id, id, holding_id, shop_id, item_id, kind, sessions, value_minor, currency, at)
           select $1, x.id, h.id, (select s.shop_id from books.sale s where s.tenant_id = h.tenant_id and s.id = h.sale_id), x.item, 'expired', x.sessions,
                  case when x.n = 1 then $4::bigint else 0 end, h.currency, $5
             from books.package_holding h, unnest($3::uuid[], $6::uuid[], $7::int[]) with ordinality as x(id, item, sessions, n)
            where h.id = $2 order by x.n`,
          [t.tenantId, i.holdingId, ids, -left.value, now, rows.map((r) => r.item), rows.map((r) => r.sessions)],
        );
        await journal(ctx, businessDate(now, t.timeZone), 'package_expired', ['books.package_entry', ids[0] as string], [
          ['package_liability', left.value],
          ['package_breakage', -left.value],
        ]);
        return { entryId: ids[0] as string };
      }) as Def['run'],
    },
  ],
];
