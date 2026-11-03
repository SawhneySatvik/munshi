// Surplus for good (W2-B), the office's side: listing a recipient (simulated, every one; the schema refuses any other)
// and the page that shows them with the impact tally. A recipient is an ops row, not a book: the owner or a manager adds
// one directly (ops.surplus_recipient's guard admits only them), gated first by the role map (surplus.recipients is the
// office's, D-082). Giving stock is surplus.give, a draft only (commands-surplus.ts). Every figure the page shows is a
// cell of the snapshots minted here.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { CoreError } from './errors.ts';
import { mayReadIn } from './read-roles.ts';
import { type Session, withTx } from './session.ts';
import { type Client, mint, read, type StoredSnapshot, type Viewer, viewer } from './views-common.ts';

export const RECIPIENT_KINDS = ['food_bank', 'shelter', 'community_kitchen', 'animal_shelter', 'other'] as const;
export type RecipientKind = (typeof RECIPIENT_KINDS)[number];

const newRecipient = z.strictObject({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(RECIPIENT_KINDS),
  area: z.string().trim().min(1).max(80),
});
export type RecipientInput = z.input<typeof newRecipient>;

/** Lists a recipient for the shop, as the signed-in owner or manager; refused for anyone else. Returns its id. */
export async function addRecipient(pool: pg.Pool, session: Session, input: RecipientInput): Promise<string> {
  const r = newRecipient.safeParse(input);
  if (!r.success) throw new CoreError('invalid', { fields: r.error.issues.map((i) => i.path.join('.') || '(input)') });
  const id = randomUUID();
  await withTx(pool, { kind: 'member', session }, async (c) => {
    if (!(await mayReadIn(c, 'surplus.recipients'))) throw new CoreError('refused', { fields: ['role'] });
    await c.query('insert into ops.surplus_recipient (tenant_id, id, name, kind, area) values ($1, $2, $3, $4, $5)', [
      session.tenantId,
      id,
      r.data.name,
      r.data.kind,
      r.data.area,
    ]);
  });
  return id;
}

/** The shop's recipients by name, for Offer it's choice (each simulated); none for a role surplus is not for. */
export async function recipientsIn(c: Client): Promise<{ id: string; name: string }[]> {
  if (!(await mayReadIn(c, 'surplus.recipients'))) return [];
  return read<{ id: string; name: string }>(c, 'select id::text, name from ops.surplus_recipient order by name, id');
}

/** The impact tally, minted in the page's transaction; null for a role it is not for. */
export async function viewImpact(c: Client): Promise<StoredSnapshot | null> {
  return (await mayReadIn(c, 'surplus.impact')) ? mint(c, 'surplus.impact', {}) : null;
}

export type SurplusView = { viewer: Viewer; recipients: StoredSnapshot; impact: StoredSnapshot };

/** The surplus page: the shop's recipients and the impact tally. Null for a role it is not for (the page answers 404). */
export async function viewSurplus(c: Client, session: Session): Promise<SurplusView | null> {
  if (!(await mayReadIn(c, 'surplus.recipients'))) return null;
  const impact = await viewImpact(c);
  if (!impact) return null;
  return { viewer: await viewer(c, session), recipients: await mint(c, 'surplus.recipients', {}), impact };
}
