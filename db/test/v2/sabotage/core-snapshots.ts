// Red-proofs of core's snapshots on v2 (test/v2/core/snapshots): each breaks one protection of
// packages/core/src/{snapshots,read}.ts or the snapshot schema, and its named test must fail. The v1 cases they succeed
// keep their mutation and their name, with a v2- prefix; the rest guard what v2 added (reuse, the row count, a ref's
// shape).
import type { Case } from '../../sabotage.ts';
import { mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const c3 = 'test/v2/core/snapshots/c3-snapshots.test.ts';
const SNAPSHOTS = 'packages/core/src/snapshots.ts';
const READ = 'packages/core/src/read.ts';

const C3_UNKNOWN = 'C3 an unregistered name is refused and writes nothing';
const C3_READ_ONLY = 'C3 a named read cannot write, even a registered one';
const C3_TENANT = "C3 a ref resolves only in its own tenant; anything else is 'Cannot verify'";
const C3_ACTOR = "C3 a snapshot's actor is stamped by the database: the minting member, or none for a system scope";
const C3_REUSE =
  "C3 a member's display read of identical rows reuses the day's snapshot, an agent run's never does, and a change in the books mints anew";
const C3_COUNT =
  'C3 every snapshot answers its row count at ⟨snap:ID·0·_count⟩, 0 for an empty read, and a cited count holds only while the read returns as many rows';

const ts = (sabotage: string, test: string, source: string, from: string, to: string): Case => ({ sabotage, file: c3, test, config: V2, ts: { file: source, from, to } });

export const CORE_SNAPSHOTS_CASES: Case[] = [
  ts('v2-c3-any-name', C3_UNKNOWN, SNAPSHOTS, "if (!q) throw new CoreError('unknown_query');", "if (!q) return QUERIES.get('stock.on_hand') as NamedQuery;"),
  ts('v2-c3-read-writable', C3_READ_ONLY, SNAPSHOTS, "await c.query('set transaction read only');", ''),
  // v1's leak was a policy on snap.snapshot_cell; the cells now live in snap.snapshot's rows
  { sabotage: 'v2-c3-cell-leak', file: c3, test: C3_TENANT, config: V2, sql: 'create policy leak on snap.snapshot using (true);' },
  // a ref object with a negative row reaches jsonb, whose `-> -1` is the last row
  ts('v2-c3-negative-row', C3_TENANT, READ, 'parseRef(typeof ref === \'string\' ? ref : formatRef(ref))', "(typeof ref === 'string' ? parseRef(ref) : ref)"),
  { sabotage: 'v2-c3-actor-unstamped', file: c3, test: C3_ACTOR, config: V2, sql: mutate('snap.snap_check()', 'new.actor_id := ctx_actor;', '') },
  // reuse dropped: every display read inserts
  ts('v2-c3-no-reuse', C3_REUSE, SNAPSHOTS, 'if (reused) return { id: reused, name, rows };', ''),
  // an agent run's evidence read takes a member's display snapshot, which no run minted (the validator's not_this_run)
  ts('v2-c3-reuse-evidence', C3_REUSE, SNAPSHOTS, "where x.purpose = 'display' and s.purpose", 'where s.purpose'),
  // reuse of any age: a reused snapshot may be a day from its purge
  ts('v2-c3-reuse-any-age', C3_REUSE, SNAPSHOTS, " and s.created_at > now() - interval '1 day'", ''),
  ts('v2-c3-count-uncitable', C3_COUNT, READ, 'if (r.col === COUNT_COL) {', 'if (false) {'),
  ts('v2-c3-count-any-row', C3_COUNT, READ, '    if (r.row !== 0) return null;\n', ''),
  // a cited row count is re-checked like a cell of a row: it never holds, so every draft citing one goes stale
  ts('v2-c3-count-not-rechecked', C3_COUNT, SNAPSHOTS, 'if (ref.col === COUNT_COL) {', 'if (false) {'),
];
