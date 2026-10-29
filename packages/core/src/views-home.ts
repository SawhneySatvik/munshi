// The owner home's reads (apps/web/lib/server/home.ts shows them): the latest brief, its open findings, the reorder drafts
// waiting or decided since the brief, and every snapshot a figure on the page points into, with all its stored cells.
// The brief's overdue-credit total is minted once per business date: the app mints only as an active member (v2's
// snap_check), so the first member to open the home that day mints it, as a display read.
import type { CellRef } from './read.ts';
import type { Session } from './session.ts';
import {
  type Client,
  draftStamps,
  itemList,
  latestBrief,
  mint,
  read,
  type StoredSnapshot,
  storedSnapshots,
  supplierList,
  type Viewer,
  viewer,
} from './views-common.ts';

export type HomeFinding = { id: string; kind: string; snapshotId: string; snapshotRow: number };
export type HomeDraft = {
  id: string;
  payload: { supplierId: string; lines: { itemId: string; qtyMilli: number }[] };
  payloadRefs: Record<string, CellRef>;
  status: 'proposed' | 'executed' | 'rejected' | 'stale' | 'failed' | 'superseded';
};
export type HomeView = {
  viewer: Viewer;
  brief: { runId: string; startedAt: Date; asOf: string; totalId: string | null } | null;
  findings: HomeFinding[];
  drafts: HomeDraft[];
  snapshots: StoredSnapshot[];
  suppliers: Map<string, { name: string; simulated: boolean }>;
  items: Map<string, string>;
  stamps: Map<string, { by: string; at: string }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function viewHome(c: Client, session: Session): Promise<HomeView> {
  const me = await viewer(c, session);
  const latest = await latestBrief(c);
  let brief: HomeView['brief'] = null;
  if (latest) {
    const [total] = await read<{ id: string }>(
      c,
      `select id::text from snap.snapshot where query_name = 'credit.overdue_total' and params->>'as_of' = $1 order by created_at desc limit 1`,
      [latest.asOf],
    );
    brief = { ...latest, totalId: total?.id ?? (await mint(c, 'credit.overdue_total', { as_of: latest.asOf })).id };
  }
  const findings = (
    await read<{ id: string; kind: string; snapshot_id: string; snapshot_row: number }>(
      c,
      "select id::text, kind, snapshot_id::text, snapshot_row from ai.finding where status = 'open' order by created_at, snapshot_row",
    )
  ).map((f) => ({ id: f.id, kind: f.kind, snapshotId: f.snapshot_id, snapshotRow: f.snapshot_row }));
  const drafts = (
    await read<{ id: string; payload: HomeDraft['payload']; payload_refs: Record<string, CellRef>; status: HomeDraft['status'] }>(
      c,
      `select id::text, payload, payload_refs, status from approval.draft
        where command = 'reorder.place' and (status = 'proposed' or updated_at >= $1::timestamptz) order by created_at`,
      [brief?.startedAt ?? null],
    )
  ).map((d) => ({ id: d.id, payload: d.payload, payloadRefs: d.payload_refs, status: d.status }));

  const ids = [
    ...findings.map((f) => f.snapshotId),
    ...(brief?.totalId ? [brief.totalId] : []),
    ...drafts.flatMap((d) => Object.values(d.payloadRefs).map((r) => r.snapshotId)),
  ];
  const snapshots = await storedSnapshots(c, ids);
  const supplierIds = new Set<string>();
  for (const f of findings) {
    const cell = f.kind === 'price_creep' ? snapshots.find((s) => s.id === f.snapshotId)?.rows[f.snapshotRow]?.supplier_id : undefined;
    if (cell?.kind === 'text') supplierIds.add(cell.txt);
  }
  for (const d of drafts) supplierIds.add(d.payload.supplierId);
  const suppliers = await supplierList(c, [...supplierIds].filter((id) => UUID.test(id)));
  const items = await itemList(c, { ids: drafts.flatMap((d) => d.payload.lines.map((l) => l.itemId)).filter((id) => UUID.test(id)) });
  return {
    viewer: me,
    brief,
    findings,
    drafts,
    snapshots,
    suppliers: new Map(suppliers.map((s) => [s.id, { name: s.name, simulated: s.simulated }])),
    items: new Map(items.map((i) => [i.id, i.name])),
    stamps: await draftStamps(c, drafts.map((d) => d.id)),
  };
}
