// The hero chain's reads (apps/web/lib/server/hero.ts shows them): the business date a question is asked as of, the
// drafts a photo left (each with the snapshots its payload refs point into, its items, its supplier and its decision
// stamp), the drafts a repeat photo already left waiting (matched on the photo's sha256 in its run's evidence row), and
// a shelf count's item names and stored model responses. Figures stay cells of the snapshots the run minted.
import type { CellRef } from './read.ts';
import type { Session } from './session.ts';
import {
  asOfDate,
  type Client,
  draftStamps,
  itemList,
  read,
  type StoredSnapshot,
  storedSnapshots,
  supplierList,
  type Viewer,
  viewer,
} from './views-common.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The shop's business date a question is asked as of. */
export async function viewAskDate(c: Client, session: Session): Promise<string> {
  return asOfDate(c, (await viewer(c, session)).timeZone);
}

export type PhotoDraftRow = {
  id: string;
  command: string;
  payload: Record<string, unknown>;
  payloadRefs: Record<string, CellRef>;
  status: 'proposed' | 'executed' | 'rejected' | 'stale' | 'failed' | 'superseded';
};

export type PhotoDraftsView = {
  drafts: PhotoDraftRow[];
  snapshots: StoredSnapshot[];
  viewer: Viewer;
  firms: { id: string; name: string; simulated: boolean }[];
  items: Map<string, string>;
  stamps: Map<string, { by: string; at: string }>;
};

/** Photo drafts by id, or every stock.count / purchase.record draft a run left waiting. */
export async function viewPhotoDrafts(
  c: Client,
  session: Session,
  which: { ids: string[] } | { waiting: 'stock.count' | 'purchase.record' },
): Promise<PhotoDraftsView | null> {
  type Row = { id: string; command: string; payload: Record<string, unknown>; payload_refs: Record<string, CellRef>; status: PhotoDraftRow['status'] };
  const rows =
    'ids' in which
      ? await read<Row>(c, 'select id::text, command, payload, payload_refs, status from approval.draft where id = any($1::uuid[]) order by created_at', [
          which.ids,
        ])
      : await read<Row>(
          c,
          "select id::text, command, payload, payload_refs, status from approval.draft where command = $1 and status = 'proposed' and run_id is not null order by created_at",
          [which.waiting],
        );
  const drafts = rows
    .filter((d) => d.command === 'stock.count' || d.command === 'purchase.record')
    .map((d) => ({ id: d.id, command: d.command, payload: d.payload, payloadRefs: d.payload_refs, status: d.status }));
  if (!drafts.length) return null;
  const snapshots = await storedSnapshots(c, drafts.flatMap((d) => Object.values(d.payloadRefs).map((r) => r.snapshotId)));
  const me = await viewer(c, session);
  const firms = await supplierList(c);
  const itemIds = drafts.flatMap((d) =>
    d.command === 'stock.count' ? [String(d.payload.itemId)] : ((d.payload.lines as { itemId: string }[] | undefined) ?? []).map((l) => l.itemId),
  );
  const items = await itemList(c, { ids: itemIds.filter((i) => UUID.test(i)) });
  return { drafts, snapshots, viewer: me, firms, items: new Map(items.map((i) => [i.id, i.name])), stamps: await draftStamps(c, drafts.map((d) => d.id)) };
}

/**
 * The drafts a photo with these very bytes (its sha256, hex) already left waiting: for a shelf, any stock.count of a
 * run whose shelf count has that photo; for a bill, the purchase.record of a run whose bill read has that photo and
 * supplier. Empty when none waits.
 */
export async function viewWaitingFor(c: Client, photoSha256: string, kind: { shelf: true } | { bill: string }): Promise<string[]> {
  const rows =
    'bill' in kind
      ? await read<{ id: string }>(
          c,
          `select d.id::text from approval.draft d join ops.bill_read e on e.tenant_id = d.tenant_id and e.run_id = d.run_id
            where d.command = 'purchase.record' and d.status = 'proposed' and e.photo_sha256 = decode($1, 'hex') and e.supplier_id = $2
            order by d.created_at`,
          [photoSha256, kind.bill],
        )
      : await read<{ id: string }>(
          c,
          `select d.id::text from approval.draft d where d.command = 'stock.count' and d.status = 'proposed'
              and exists (select 1 from ops.shelf_count e where e.tenant_id = d.tenant_id and e.run_id = d.run_id and e.photo_sha256 = decode($1, 'hex'))
            order by d.created_at`,
          [photoSha256],
        );
  return rows.map((r) => r.id);
}

/** A shelf count's figures (the snapshots the run minted), its items' names, and each count's stored model response. */
export async function viewShelfCounts(c: Client, snapshotIds: string[], itemIds: string[], countIds: string[]) {
  const snapshots = await storedSnapshots(c, snapshotIds);
  const names = new Map((await itemList(c, { ids: itemIds })).map((i) => [i.id, i.name]));
  const raws = new Map(
    (await read<{ id: string; raw: string }>(c, 'select id::text, raw from ops.shelf_count where id = any($1::uuid[])', [countIds])).map((x) => [x.id, x.raw]),
  );
  return { snapshots, names, raws };
}
