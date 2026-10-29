// Commands for offers and loyalty, each the owner's own (ref.command_authority). An offer is a price, so never an AI
// run's draft (b_offer_by_person); it is judged again at every sale that names its code (sale.record). The loyalty rule
// in effect, the latest, sets how a named customer earns and redeems points. Helpers from commands.ts are used only
// inside run(), so the value import is safe while commands.ts spreads OFFER_COMMANDS.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { at, type CommandResult, type Ctx, type Def } from './commands.ts';

const id = z.guid();
const minor = z.number().int().safe();
const instant = z.iso.datetime({ offset: true });

// The kind's amount and only it; a category for a category offer, items for an items offer, neither otherwise.
const offerCreate = z
  .strictObject({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(['percent_off', 'amount_off']),
    percentBp: z.number().int().min(1).max(9000).optional(),
    amountOffMinor: minor.positive().optional(),
    scope: z.enum(['all', 'category', 'items']),
    category: z.string().trim().min(1).max(60).optional(),
    itemIds: z.array(id).min(1).max(200).optional(),
    minSpendMinor: minor.nonnegative().optional(),
    code: z
      .string()
      .regex(/^[A-Z0-9]{4,16}$/)
      .optional(),
    maxRedemptions: z.number().int().positive().max(1_000_000).optional(),
    perCustomerLimit: z.number().int().positive().max(1000).optional(),
    startsAt: instant.optional(),
    endsAt: instant,
    published: z.boolean().default(false),
  })
  .refine((i) => (i.kind === 'percent_off') === (i.percentBp !== undefined) && (i.kind === 'amount_off') === (i.amountOffMinor !== undefined), {
    path: ['kind'],
  })
  .refine((i) => (i.scope === 'category') === (i.category !== undefined) && (i.scope === 'items') === (i.itemIds !== undefined), { path: ['scope'] });
// ref.reason_use's codes for a decision.
const offerEnd = z.strictObject({ offerId: id, reason: z.enum(['wrong_figure', 'duplicate', 'not_now', 'not_relevant', 'other']), endedAt: instant.optional() });
const loyaltyRuleSet = z.strictObject({
  earnPer100: z.number().int().min(0).max(10_000),
  pointValueMinor: minor.positive(),
  minRedeem: z.number().int().positive().max(1_000_000),
  effectiveFrom: instant.optional(),
});

function def<S extends z.ZodType>(input: S, run: (ctx: Ctx, input: z.output<S>) => Promise<CommandResult>): Def {
  return { input, run: run as Def['run'] };
}

export const OFFER_COMMANDS: [string, Def][] = [
  [
    'offer.create',
    def(offerCreate, async ({ c, t }, i) => {
      const offerId = randomUUID();
      await c.query(
        `insert into books.offer (tenant_id, id, name, kind, percent_bp, amount_off_minor, currency, scope, category, min_spend_minor, code,
                                  max_redemptions, per_customer_limit, starts_at, ends_at, published)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          t.tenantId,
          offerId,
          i.name,
          i.kind,
          i.percentBp ?? null,
          i.amountOffMinor ?? null,
          t.currency,
          i.scope,
          i.category ?? null,
          i.minSpendMinor ?? null,
          i.code ?? null,
          i.maxRedemptions ?? null,
          i.perCustomerLimit ?? null,
          at(i.startsAt),
          new Date(i.endsAt),
          i.published,
        ],
      );
      if (i.itemIds) {
        await c.query('insert into books.offer_item (tenant_id, offer_id, item_id) select $1, $2, x from unnest($3::uuid[]) as x', [
          t.tenantId,
          offerId,
          [...new Set(i.itemIds)],
        ]);
      }
      return { offerId };
    }),
  ],
  [
    // Ending an offer early, once (offer_end_once): a sale at or after ended_at no longer takes it.
    'offer.end',
    def(offerEnd, async ({ c, t }, i) => {
      const endId = randomUUID();
      await c.query('insert into books.offer_end (tenant_id, id, offer_id, ended_at, reason) values ($1, $2, $3, $4, $5)', [
        t.tenantId,
        endId,
        i.offerId,
        at(i.endedAt),
        i.reason,
      ]);
      return { endId };
    }),
  ],
  [
    'loyalty.rule.set',
    def(loyaltyRuleSet, async ({ c, t }, i) => {
      const ruleId = randomUUID();
      await c.query(
        'insert into books.loyalty_rule (tenant_id, id, earn_per_100, point_value_minor, currency, min_redeem, effective_from) values ($1, $2, $3, $4, $5, $6, $7)',
        [t.tenantId, ruleId, i.earnPer100, i.pointValueMinor, t.currency, i.minRedeem, at(i.effectiveFrom)],
      );
      return { ruleId };
    }),
  ],
];
