// Red-proofs of the grid gates (test/v2/gates/20-grid.test.ts).
import type { Case } from './case.ts';
import { asOwner, dropCheck, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/20-grid.test.ts';
const t = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: FILE, test, config: V2, sql });

const GR3 = 'GR3 a batch is an active member’s own, stamped whatever was sent, its file an import, and pins the snapshot it was opened on; its changes come only in its transaction, by that member';
const GR4 = 'GR4 a batch takes at most 500 changes, one per line, each naming exactly its kind’s fields';

export const GRID_CASES: Case[] = [
  t(GR3, 'v2-gr3-member', mutate('ops.grid_batch_guard()', "if current_user <> 'munshi_app' or not exists (", "if current_user <> 'munshi_app' or false and not exists (")),
  t(GR3, 'v2-gr3-stamp', mutate('ops.grid_batch_guard()', '  new.created_by := ctx_actor;\n', '')),
  t(GR3, 'v2-gr3-import', mutate('ops.grid_batch_guard()', "and d.kind = 'import' and d.erased_at is null) then", 'and d.erased_at is null) then')),
  t(GR3, 'v2-gr3-pin', asOwner('drop trigger pin on ops.grid_batch;')),
  t(GR3, 'v2-gr3-same-transaction', mutate('ops.grid_change_guard()', 'and b.created_txid = txid_current()\n', '\n')),
  t(GR3, 'v2-gr3-same-member', mutate('ops.grid_change_guard()', "\n          and b.created_by = nullif(current_setting('munshi.actor_id', true), '')::uuid", '')),
  t(GR4, 'v2-gr4-cap', dropCheck('ops.grid_change', '(line_no >= 1)')),
  t(GR4, 'v2-gr4-line-once', asOwner('drop index ops.grid_change_line;')),
  t(GR4, 'v2-gr4-kind-fields', dropCheck('ops.grid_change', "(kind = 'new_item'::text) = (add_key IS NOT NULL)")),
];
