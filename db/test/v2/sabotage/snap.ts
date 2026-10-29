// Red-proofs of the snapshot gates (test/v2/gates/06-snap.test.ts).
import type { Case } from './case.ts';
import { asOwner, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/06-snap.test.ts';
const t = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: FILE, test, config: V2, sql });
const CHECK = 'snap.snap_check()';

const C3_SHAPE = "C3 a snapshot's cells are checked set-based: one cell per column, each of its column's kind with exactly its fields; at most 500 rows; distinct columns";
const C3_FIXED = 'C3 a snapshot never changes, whoever asks';
const C3_OWNER = 'C3 the owner role mints only a release snapshot, with no actor (off live only the owner publishes, the reset)';
const J2_PURGE = 'J2 the purge deletes old unpinned display, watch and evidence snapshots of its tenant, and never a pinned, recent or release one';
const J2_RACE = 'J2 a pin and a purge racing on one snapshot never leave a pin without its snapshot, in either order';
const J2_HOLDER = "J2 a pin is written only by its holder's trigger";
const PUB1 = 'PUB1 the public role reads only snapshots a release pins, and only release pins';

const purgePolicy = (using: string) =>
  `drop policy snapshot_purge on snap.snapshot; create policy snapshot_purge on snap.snapshot as restrictive for delete to munshi_jobs using (${using});`;

export const SNAP_CASES: Case[] = [
  t(C3_SHAPE, 'v2-c3-cell-fields', mutate(CHECK, "cell.v - array['k', 'n', 'c'] = '{}'::jsonb and ", '')),
  // a cell missing a field makes its test NULL, which bool_and skips
  t(C3_SHAPE, 'v2-c3-null-skip', mutate(CHECK, 'else false end, false)), true) into ok', 'else false end, true)), true) into ok')),
  t(C3_SHAPE, 'v2-c3-row-cap', mutate(CHECK, ' or jsonb_array_length(new.rows) > 500', '')),
  t(C3_FIXED, 'v2-c3-immutable', mutate(CHECK, "if tg_op <> 'INSERT' then", 'if false then')),
  t(C3_OWNER, 'v2-c3-owner-display', mutate(CHECK, "if new.purpose <> 'release' or ctx_actor is not null then", 'if false then')),
  // the purge without its pin clause, then without its age clause
  t(J2_PURGE, 'v2-j2-pin-clause', purgePolicy(`purpose in ('display', 'watch', 'evidence') and created_at < now() - interval '7 days'`)),
  t(J2_PURGE, 'v2-j2-purge-age', purgePolicy(
    `purpose in ('display', 'watch', 'evidence') and not exists (select 1 from snap.pin p where p.tenant_id = snapshot.tenant_id and p.snapshot_id = snapshot.id)`,
  )),
  t(J2_RACE, 'v2-j2-pin-fk', 'alter table snap.pin drop constraint pin_tenant_id_snapshot_id_fkey;'),
  t(J2_HOLDER, 'v2-j2-pin-guard', asOwner('drop trigger from_holder on snap.pin;')),
  t(PUB1, 'v2-pub1-snapshot-policy', 'drop policy snapshot_public on snap.snapshot;'),
  t(PUB1, 'v2-pub1-pin-policy', 'drop policy pin_public on snap.pin;'),
];
