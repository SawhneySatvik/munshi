// The names of the people a shop knows, for the screens: a customer's or supplier's latest link in effect
// (books.party_contact) to its contact in the vault (ops.contact). A name is never a snapshot cell: a
// view reads it here, beside the figures, so an erased person's name is gone from every screen at once. Every member's
// role sees names; phones are not read here, so there is nothing to mask. The agent never calls this: it holds
// ids only.
import type pg from 'pg';
import { runReadOnly } from './snapshots.ts';

/** What a screen shows for a person whose contact was erased. */
export const ERASED = 'Erased';

export type Party = 'customer' | 'supplier';

/** Every customer or supplier of the shop (or those among `ids`), by name; '' for one with no contact linked. */
export async function namesOf(c: pg.PoolClient, party: Party, ids?: string[]): Promise<{ id: string; name: string }[]> {
  const rows = (await runReadOnly(
    c,
    `select p.id::text, ct.name, ct.erased_at is not null as erased
       from books.${party} p
       left join lateral (select l.contact_id from books.party_contact l
                           where l.tenant_id = p.tenant_id and l.${party}_id = p.id and l.effective_from <= now()
                           order by l.effective_from desc, l.created_at desc, l.id desc limit 1) l on true
       left join ops.contact ct on ct.tenant_id = p.tenant_id and ct.id = l.contact_id
      where $1::uuid[] is null or p.id = any($1::uuid[])
      order by ct.name, p.id`,
    [ids ?? null],
  )) as { id: string; name: string | null; erased: boolean }[];
  return rows.map((r) => ({ id: r.id, name: r.erased ? ERASED : (r.name ?? '') }));
}
