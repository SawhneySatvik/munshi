// Commands for the catalogue: an item (its identity, and its name in a first revision), another spelling of it, and its
// price. A later name or category is a new revision (item.revise, not yet built); the latest in effect wins. Helpers
// from commands.ts are used only inside run(), so the value import is safe while commands.ts spreads this list.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { at, type CommandResult, type Ctx, type Def, normalName } from './commands.ts';

const id = z.guid();
const minor = z.number().int().safe();
const instant = z.iso.datetime({ offset: true });
const name = z.string().trim().min(1).max(120);

// Goods only: a service or package item arrives with its own lane (bookings, packages).
const itemCreate = z.strictObject({
  name,
  unit: z.enum(['piece', 'pack', 'kg', 'g', 'l', 'ml']),
  barcode: z.string().trim().min(1).max(64).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  effectiveFrom: instant.optional(),
});
const itemAlias = z.strictObject({ itemId: id, alias: name });
const priceSet = z.strictObject({ itemId: id, amountMinor: minor.nonnegative(), effectiveFrom: instant.optional() });

function def<S extends z.ZodType>(input: S, run: (ctx: Ctx, input: z.output<S>) => Promise<CommandResult>): Def {
  return { input, run: run as Def['run'] };
}

export const CATALOGUE_COMMANDS: [string, Def][] = [
  [
    'item.create',
    def(itemCreate, async ({ c, t }, i) => {
      const itemId = randomUUID();
      await c.query(`insert into books.item (tenant_id, id, kind, unit) values ($1, $2, 'good', $3)`, [t.tenantId, itemId, i.unit]);
      await c.query('insert into books.item_revision (tenant_id, item_id, name, category, barcode, effective_from) values ($1, $2, $3, $4, $5, $6)', [
        t.tenantId,
        itemId,
        i.name,
        i.category ?? null,
        i.barcode ?? null,
        at(i.effectiveFrom),
      ]);
      return { itemId };
    }),
  ],
  [
    // Another spelling of an item (a supplier's bill line), stored normalised so a bill's text matches it exactly.
    'item.alias',
    def(itemAlias, async ({ c, t }, i) => {
      const aliasId = randomUUID();
      await c.query('insert into books.item_alias (tenant_id, id, item_id, alias) values ($1, $2, $3, $4)', [t.tenantId, aliasId, i.itemId, normalName(i.alias)]);
      return { aliasId };
    }),
  ],
  [
    'price.set',
    def(priceSet, async ({ c, t }, i) => {
      const priceId = randomUUID();
      await c.query('insert into books.price (tenant_id, id, item_id, amount_minor, currency, effective_from) values ($1, $2, $3, $4, $5, $6)', [
        t.tenantId,
        priceId,
        i.itemId,
        i.amountMinor,
        t.currency,
        at(i.effectiveFrom),
      ]);
      return { priceId };
    }),
  ],
];
