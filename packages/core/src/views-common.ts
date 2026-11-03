// What every screen view shares: the page's one transaction, the reads run in it (each in a read-only savepoint), the
// snapshots it mints or reads back, and the names and stamps a page shows beside its figures. Names come from the books
// (an item's latest revision, a member's display name) and from people.ts (a customer's or supplier's contact in the
// vault); they are never figures, and a person's name is never a snapshot cell.
import type pg from 'pg';
import { namesOf } from './people.ts';
import { type Cell, cellFromJson, type JsonCell, type JsonColumn } from './read.ts';
import { askerIn, rowsFor } from './read-roles.ts';
import { type Session, withTx } from './session.ts';
import { mintIn, runReadOnly } from './snapshots.ts';
import { businessDate } from './time.ts';

export type Client = pg.PoolClient;

// One transaction per page: the member's context is set once, every read runs in it, and every snapshot
// the page mints is inserted (or reused) in it. Not READ ONLY as a whole, because the mints insert; each direct read is
// read only through its savepoint (runReadOnly), so the reads must run one after another, never in a Promise.all.
export function withPage<T>(pool: pg.Pool, session: Session, fn: (c: Client) => Promise<T>): Promise<T> {
  return withTx(pool, { kind: 'member', session }, fn);
}

export const read = <R>(c: Client, sql: string, values: unknown[] = []) => runReadOnly(c, sql, values) as Promise<R[]>;

/**
 * A snapshot as a page shows it: its stored cells by column, the time of the read behind it, and the name of each person
 * its rows name by id (a customer_id or supplier_id cell), read from people.ts: shown beside the cells, never one.
 */
export type StoredSnapshot = { id: string; query: string; readAt: string; rows: Record<string, Cell>[]; names: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The people the rows name by id, by id: ERASED for an erased contact.
async function namesIn(c: Client, rows: Record<string, Cell>[]): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  for (const party of ['customer', 'supplier'] as const) {
    const ids = new Set<string>();
    for (const row of rows) {
      const cell = row[`${party}_id`];
      if (cell?.kind === 'text' && UUID.test(cell.txt)) ids.add(cell.txt);
    }
    if (ids.size) for (const p of await namesOf(c, party, [...ids])) names[p.id] = p.name;
  }
  return names;
}

/**
 * The stored snapshots among `ids` that this tenant holds, each once, in the order asked. A member is given only those
 * whose read their role may make now, each row cut to the columns their role is sent (read-roles.ts): a snapshot
 * of the office's is dropped, failing closed, however its id reached the view; the stored snapshot stays whole.
 */
export async function storedSnapshots(c: Client, ids: string[]): Promise<StoredSnapshot[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const found = await read<{ id: string; query_name: string; columns: JsonColumn[]; rows: JsonCell[][]; created_at: Date }>(
    c,
    'select id::text, query_name, columns, rows, created_at from snap.snapshot where id = any($1::uuid[])',
    [unique],
  );
  const asker = await askerIn(c);
  const shown = unique.flatMap((id) => {
    const s = found.find((x) => x.id === id);
    if (!s || (asker && !asker.reads.has(s.query_name))) return [];
    const rows = s.rows.map((row) => Object.fromEntries(row.map((cell, i) => [(s.columns[i] as JsonColumn).n, cellFromJson(cell)])));
    return [{ id, query: s.query_name, readAt: s.created_at.toISOString(), rows: asker ? rowsFor(asker.role, s.query_name, rows) : rows }];
  });
  const names = await namesIn(c, shown.flatMap((s) => s.rows));
  return shown.map((s) => ({ ...s, names }));
}

/** Runs a named read as the page's member and keeps its snapshot (core's mintIn, in the page's transaction). */
export async function mint(c: Client, query: string, params: Record<string, unknown>): Promise<StoredSnapshot> {
  const made = await mintIn(c, query, params);
  const asker = await askerIn(c);
  const rows = asker ? rowsFor(asker.role, query, made.rows) : made.rows;
  // The read's own time, never a reused snapshot's created_at.
  return { id: made.id, query, readAt: new Date().toISOString(), rows, names: await namesIn(c, rows) };
}

export type Viewer = { tenantName: string; timeZone: string; member: { name: string; role: string }; mayRun: Set<string> };

/** The signed-in member, their shop, and the commands their role holds. */
export async function viewer(c: Client, session: Session): Promise<Viewer> {
  const [tenant] = await read<{ name: string; time_zone: string }>(c, 'select name, time_zone from ops.tenant');
  const [member] = await read<{ name: string; role: string }>(c, 'select display_name as name, role from ops.member where id = $1', [session.memberId]);
  if (!tenant || !member) throw new Error("views: the signed-in member's shop is not readable");
  const may = await read<{ command: string }>(c, 'select command from ref.command_authority where role = $1', [member.role]);
  return { tenantName: tenant.name, timeZone: tenant.time_zone, member, mayRun: new Set(may.map((r) => r.command)) };
}

/** The shop's data class (a real shop's 'live', or a sample's) and its slug: what a signed-in page names on <html>. */
export async function viewShopMark(c: Client): Promise<{ dataClass: string; slug: string | null } | null> {
  const [t] = await read<{ data_class: string; slug: string | null }>(
    c,
    'select t.data_class, d.slug from ops.tenant t left join ops.tenant_directory d on d.tenant_id = t.tenant_id',
  );
  return t ? { dataClass: t.data_class, slug: t.slug } : null;
}

/** The signed-in member's name and role, or null when the member is not there. */
export async function signedInMember(c: Client, session: Session): Promise<{ name: string; role: string } | null> {
  return (await read<{ name: string; role: string }>(c, 'select display_name as name, role from ops.member where id = $1', [session.memberId]))[0] ?? null;
}

/** The latest finished watcher run (the morning brief), its start and business date; null before the first. */
export async function latestBrief(c: Client): Promise<{ runId: string; startedAt: Date; asOf: string } | null> {
  const [run] = await read<{ id: string; started_at: Date; as_of: string | null }>(
    c,
    `select r.id::text, r.started_at, (select s.params->>'as_of' from snap.snapshot s where s.run_id = r.id limit 1) as as_of
       from ai.run r where r.trigger = 'watcher' and r.ended_at is not null order by r.started_at desc limit 1`,
  );
  return run?.as_of ? { runId: run.id, startedAt: run.started_at, asOf: run.as_of } : null;
}

/** The shop's business date the pages read up to: the latest watcher run's (the morning brief's), else today's. */
export async function asOfDate(c: Client, timeZone: string): Promise<string> {
  return (await latestBrief(c))?.asOf ?? businessDate(new Date(), timeZone);
}

/** Every supplier of the shop (or those among `ids`), by name (people.ts), with whether it is simulated. */
export async function supplierList(c: Client, ids?: string[]): Promise<{ id: string; name: string; simulated: boolean }[]> {
  const simulated = new Map(
    (
      await read<{ id: string; simulated: boolean }>(
        c,
        'select id::text, is_simulated as simulated from books.supplier where $1::uuid[] is null or id = any($1::uuid[])',
        [ids ?? null],
      )
    ).map((s) => [s.id, s.simulated]),
  );
  // A supplier the books do not say is real is labelled simulated.
  return (await namesOf(c, 'supplier', ids)).map((s) => ({ ...s, simulated: simulated.get(s.id) ?? true }));
}

/** Every customer of the shop (or those among `ids`), by name (people.ts). */
export const customerList = (c: Client, ids?: string[]) => namesOf(c, 'customer', ids);

/**
 * Every item of the shop (or those among `ids`): its name and category from its latest revision in effect, and its unit;
 * by name, or by category then name.
 */
export async function itemList(
  c: Client,
  opts: { ids?: string[]; byCategory?: boolean } = {},
): Promise<{ id: string; name: string; unit: string; category: string }[]> {
  return read(
    c,
    `select i.id::text, r.name, i.unit, coalesce(r.category, '') as category
       from books.item i
       join lateral (select v.name, v.category from books.item_revision v
                      where v.tenant_id = i.tenant_id and v.item_id = i.id and v.effective_from <= now()
                      order by v.effective_from desc, v.created_at desc, v.id desc limit 1) r on true
      where $1::uuid[] is null or i.id = any($1::uuid[]) order by ${opts.byCategory ? '4, 2, 1' : '2, 1'}`,
    [opts.ids ?? null],
  );
}

/** A books table a person's own command writes, by its short name (the screens name rows, never tables). */
export type BookRow = 'sale' | 'purchase' | 'payment' | 'credit_entry' | 'stock_move';

/** Who wrote a book row and when: its audit entry. */
export async function stampOf(c: Client, table: BookRow, id: string): Promise<{ by: string; at: string }> {
  const [row] = await read<{ at: Date; by: string }>(
    c,
    `select a.created_at as at, m.display_name as by from audit.audit_log a join ops.member m on m.tenant_id = a.tenant_id and m.id = a.actor_id
      where a.entity = $1 and a.entity_id = $2 and a.action = 'insert' order by a.seq limit 1`,
    [`books.${table}`, id],
  );
  if (!row) throw new Error('views: a written row has no audit entry');
  return { by: row.by, at: row.at.toISOString() };
}

/** Each decided draft's last decision stamp (executed, rejected or stale), by draft id. */
export async function draftStamps(c: Client, draftIds: string[]): Promise<Map<string, { by: string; at: string }>> {
  const rows = await read<{ draft_id: string; at: Date; by: string }>(
    c,
    `select distinct on (a.entity_id) a.entity_id::text as draft_id, a.created_at as at, m.display_name as by
       from audit.audit_log a join ops.member m on m.tenant_id = a.tenant_id and m.id = a.actor_id
      where a.entity = 'approval.draft' and a.entity_id = any($1::uuid[]) and a.action in ('draft.executed', 'draft.rejected', 'draft.stale')
      order by a.entity_id, a.seq desc`,
    [draftIds],
  );
  return new Map(rows.map((s) => [s.draft_id, { by: s.by, at: s.at.toISOString() }]));
}
