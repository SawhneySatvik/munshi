// The Keeper's desk and "why this number", each in the page's one transaction. The Keeper's desk: the notes in
// force (memory.in_force, the office's), each with its words read beside the cells (never a cell: the words are a
// person's and may be erased) and the names of who decided and who noted. "Why this number": the walk from one figure
// (why.chain), cut to the nodes the member's role may read, with the name of each member it names.
import { CoreError } from './errors.ts';
import { type CellRef, formatRef, parseRef } from './read.ts';
import { askerIn, hiddenColumns } from './read-roles.ts';
import type { Session } from './session.ts';
import { type Client, mint, read, type StoredSnapshot, viewer } from './views-common.ts';

/** Members' display names by id (who read, wrote, decided or noted). */
async function memberNames(c: Client, ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const rows = await read<{ id: string; name: string }>(c, 'select id::text, display_name as name from ops.member where id = any($1::uuid[])', [unique]);
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

const textCells = (s: StoredSnapshot, cols: string[]) =>
  s.rows.flatMap((row) => cols.flatMap((col) => (row[col]?.kind === 'text' ? [(row[col] as { txt: string }).txt] : [])));

export type KeeperView = {
  snapshot: StoredSnapshot;
  /** each note's words, by memory_id */
  words: Record<string, string>;
  members: Record<string, string>;
  /** Forget is the owner's alone */
  canForget: boolean;
  /** the shop's zone, for "written today" */
  timeZone: string;
};

/** The notes in force with their source chips; null for a member whose role may not read memory (the office's). */
export async function viewKeeper(c: Client, session: Session): Promise<KeeperView | null> {
  const asker = await askerIn(c);
  if (asker && !asker.reads.has('memory.in_force')) return null;
  const snapshot = await mint(c, 'memory.in_force', {});
  const words = await read<{ id: string; text: string }>(c, 'select id::text, text from ai.memory_in_force()');
  const me = await viewer(c, session);
  return {
    snapshot,
    words: Object.fromEntries(words.map((w) => [w.id, w.text])),
    members: await memberNames(c, textCells(snapshot, ['decided_by', 'noted_by'])),
    canForget: me.member.role === 'owner',
    timeZone: me.timeZone,
  };
}

export type WhyView = { snapshot: StoredSnapshot; members: Record<string, string> };

/**
 * The walk from one figure's cell to who approved what it was read from. Refused (not_for_role) for a figure the member
 * may not see: a read their role may not make, or a column it is not sent. A snapshot not in the shop's books walks to a
 * `no_snapshot` break ("Cannot verify").
 */
export async function viewWhy(c: Client, ref: CellRef): Promise<WhyView> {
  if (!parseRef(formatRef(ref))) throw new CoreError('invalid', { fields: ['ref'] });
  const asker = await askerIn(c);
  const [s] = await read<{ query_name: string }>(c, 'select query_name from snap.snapshot where id = $1', [ref.snapshotId]);
  if (asker && s && (!asker.reads.has(s.query_name) || hiddenColumns(asker.role, s.query_name).includes(ref.col))) {
    throw new CoreError('not_for_role', { fields: ['ref'] });
  }
  const snapshot = await mint(c, 'why.chain', { snapshot_id: ref.snapshotId, row: ref.row, col: ref.col });
  return { snapshot, members: await memberNames(c, textCells(snapshot, ['member_id'])) };
}
