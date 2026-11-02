// The office's desks and run log (apps/web/lib/server/desks.ts shows them), in the page's one transaction: desks.week
// minted once (a row per cast member, every count a cell), the window's runs newest first (ids, times and codes only,
// never a figure), all of them or one cast member's, chosen here in SQL, and, for a run that log shows and the member
// opened, its trace minted as desks.trace. Nothing is added up here.
import { castOfRun } from './queries-desks.ts';
import { type Client, mint, read, type StoredSnapshot } from './views-common.ts';

/** The screen's cast: its members in order, and the member a desk, else a trigger, names (the first: nothing names one). */
export type CastMap = { cast: string[]; desks: Record<string, string>; triggers: Record<string, string> };
export type DeskLogRow = { id: string; startedAt: string; endedAt: string | null; trigger: string; desk: string; outcome: string | null };
/** `capped`: the log holds LOG_ROWS runs, so older runs of the window may not be shown. */
export type DesksView = { week: StoredSnapshot; log: DeskLogRow[]; capped: boolean; trace: StoredSnapshot | null };

export const LOG_ROWS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function viewDesks(c: Client, map: CastMap, q: { cast?: string | undefined; run?: string | undefined } = {}): Promise<DesksView> {
  const week = await mint(c, 'desks.week', map);
  const who = q.cast && map.cast.includes(q.cast) ? q.cast : null;
  const rows = await read<{ id: string; started_at: Date; ended_at: Date | null; trigger: string; desk: string; outcome: string | null }>(
    c,
    `select r.id::text, r.started_at, r.ended_at, r.trigger, r.desk, r.outcome from ai.run r
      where r.started_at > now() - interval '7 days' and ($4::text is null or ${castOfRun('r', '$1', '$2', '$3')} = $4::text)
      order by r.started_at desc, r.id desc limit ${LOG_ROWS}`,
    [map.cast, JSON.stringify(map.desks), JSON.stringify(map.triggers), who],
  );
  const log = rows.map((r) => ({
    id: r.id,
    startedAt: r.started_at.toISOString(),
    endedAt: r.ended_at?.toISOString() ?? null,
    trigger: r.trigger,
    desk: r.desk,
    outcome: r.outcome,
  }));
  // Only a run the log shows (this window, this filter, this tenant) opens.
  const open = q.run;
  const trace = open && UUID.test(open) && log.some((r) => r.id === open) ? await mint(c, 'desks.trace', { run_id: open }) : null;
  return { week, log, capped: log.length >= LOG_ROWS, trace };
}
