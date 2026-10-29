// Red-proofs of holds on a piece (BP-F4, test/v2/core/holds/): each breaks one protection of
// packages/core/src/{reservations,queries-holds,jobs-holds}.ts or the schema, and its named test must fail.
import type { Case } from './case.ts';

const V2 = 'vitest.v2.config.ts';
const HOLDS = 'test/v2/core/holds/f4-holds.test.ts';
const EXPIRY = 'test/v2/core/holds/f4-expiry.test.ts';
const RESERVATIONS = 'packages/core/src/reservations.ts';
const QUERIES = 'packages/core/src/queries-holds.ts';
const JOBS = 'packages/core/src/jobs-holds.ts';

const ASK = 'F4 the public asks to hold a piece: one requested row with the sample contact on a demo, under no actor; it never moves its ask nor reads who asked';
const MOVES =
  "F4 an active member holds a piece until the site's reservation hours run out, declines an ask with a decline reason, and releases a hold; a final one never moves";
const LIMIT = 'F4 a member holds no more than is available, on hand minus live holds: refused as a conflict; a lapsed or released hold frees its piece';
const RACE = 'F4 a hold waits for a write-off of the same piece in flight, then finds nothing left and is refused';
const READ = "F4 the shop reads a held piece's availability as cells: on hand, held by live holds, how many holds, and available, from stock.available";
const SELL =
  'F4 a sale naming a held piece marks it sold in its own transaction; with no such sale, a sale of another item, or once it is no longer held, it is refused';
const BOOKS =
  'F4 a hold changes no book: every books table holds as many rows after asking, holding, declining, releasing, a refused conversion and expiring as before; a conversion adds only its sale';
const EXPIRES =
  "F4 the holds job expires every tenant's piece held past held_until and slot held past expires_at, a positive count each, and leaves live holds held";

const ts = (sabotage: string, file: string, test: string, source: string, from: string, to: string): Case => ({
  sabotage,
  file,
  test,
  config: V2,
  ts: { file: source, from, to },
});

export const CORE_HOLDS_CASES: Case[] = [
  // a hold writes a book row: here the customer, under a command the holding manager may run, so the guard admits it
  {
    sabotage: 'v2-holds-write-book',
    file: HOLDS,
    test: BOOKS,
    config: V2,
    sql: `create function ops.sabotage_hold_writes_book() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if new.state = 'held' and old.state <> 'held' then
    perform set_config('munshi.command', 'customer.create', true);
    insert into books.customer (tenant_id) values (new.tenant_id);
  end if;
  return new;
end $$;
create trigger sabotage_hold after update on ops.reservation for each row execute function ops.sabotage_hold_writes_book();`,
  },
  // the public may update a reservation's state: a token-less hold could then be moved by anyone holding its id
  { sabotage: 'v2-holds-public-update', file: HOLDS, test: ASK, config: V2, sql: 'grant update (state) on ops.reservation to munshi_public;' },
  // holds keep back more than the books hold
  ts('v2-holds-no-availability', HOLDS, LIMIT, RESERVATIONS, "    if (!fit[0]?.fits) throw new CoreError('conflict', { fields: ['qtyMilli'] });\n", ''),
  // the hold reads the books past a write-off in flight
  ts(
    'v2-holds-no-lock',
    HOLDS,
    RACE,
    RESERVATIONS,
    "    await c.query(`select pg_advisory_xact_lock(hashtextextended('munshi.stock:' || $1 || ':' || $2, 0))`, [session.tenantId, item]);\n",
    '',
  ),
  // a move from any state: a repeated release, or a hold of a released piece, passes silently
  ts('v2-holds-move-any-state', HOLDS, MOVES, RESERVATIONS, 'where id = $1 and state = $2`', 'where id = $1 and $2::text is not null`'),
  // a move that touched no row is taken as done: a sale converts a piece no longer held
  ts('v2-holds-move-unchecked', HOLDS, SELL, RESERVATIONS, '  if (r.rowCount === 1) return;', '  return;'),
  // the read counts asks and lapsed holds as held
  ts('v2-holds-read-counts-asks', HOLDS, READ, QUERIES, "r.state = 'held' and r.held_until > now()", "r.state in ('held', 'requested')"),
  // the job runs once with no tenant context: forced RLS shows it no hold to expire
  ts('v2-holds-job-one-context', EXPIRY, EXPIRES, JOBS, 'perTenant: true', 'perTenant: false'),
  ts('v2-holds-job-no-pieces', EXPIRY, EXPIRES, JOBS, "update ops.reservation set state = 'expired' where state = 'held' and held_until <= now()", 'select 1 where false'),
  ts('v2-holds-job-no-slots', EXPIRY, EXPIRES, JOBS, "update ops.booking set state = 'expired' where state = 'held' and expires_at <= now()", 'select 1 where false'),
];
