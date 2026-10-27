// The owner home, read from the books (server only). Every figure on it is a ref into a stored snapshot cell: the
// watchers' findings point at their snapshot rows, the overdue-credit card at its credit.overdue_total snapshot, and a
// draft's quantity at its payload ref (the cell core checked holds it). The snapshots' rows travel with the page so the source drawer shows the very
// row. All of it is read in one READ ONLY transaction under the signed-in member; the only write is minting the brief's
// credit.overdue_total once per business date (a snapshot, through core's mintSnapshot).
import {
  CELL_COLUMNS,
  type Cell,
  type CellRef,
  type CellRow,
  cellFromRow,
  mintSnapshot,
  type Session,
  withTx,
} from "@munshi/core";
import { DICT, type Dict, fillText } from "../i18n";
import type { CellValue, Column, Draft, Finding, Lang, Localized, Member, OwnerHome, Snapshot, SourceRef } from "../types";
import { appPool } from "./db";

type Client = Parameters<Parameters<typeof withTx>[2]>[0];

// The drawer's title and columns for each read the home shows: ids stay out, and every column a chip on the home points
// at is in (the drawer highlights it).
const DRAWER: Record<string, { title: keyof Dict; columns: string[]; simulatedSupplier?: boolean }> = {
  "watch.shrinkage": { title: "titleShrinkage", columns: ["item", "expected", "counted", "missing"] },
  "watch.price_creep": { title: "titlePriceCreep", columns: ["item", "baseline_cost", "latest_cost"], simulatedSupplier: true },
  "watch.expiry": { title: "titleExpiry", columns: ["item", "days_left", "remaining", "at_risk_value"] },
  "credit.overdue_total": { title: "titleOverdue", columns: ["customers", "overdue", "credit_days"] },
  "watch.short_settlement": { title: "titleShortSettlement", columns: ["business_date", "received", "settled", "short"] },
};
const KIND_ORDER = ["shrinkage", "price_creep", "overdue_credit", "expiry", "short_settlement"];

// A line whose number has no source in the books: there is no bank statement import, so Munshi cannot say what the bank
// received.
const UNVERIFIED = [
  {
    what: { en: "UPI received yesterday", hi: "कल आया UPI भुगतान" },
    reason: { en: "the bank statement has not been imported", hi: "बैंक स्टेटमेंट अभी नहीं आया" },
  },
];

const label = (key: keyof Dict, slots: Record<Lang, Record<string, string>> = { en: {}, hi: {} }): Localized => ({
  en: fillText(DICT.en[key], slots.en),
  hi: fillText(DICT.hi[key], slots.hi),
});

const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
const supplierName = (name: string, simulated: boolean) => (simulated ? name.replace(/\s*\(simulated\)$/, "") : name);

function safe(num: string): number {
  const n = Number(num);
  if (!Number.isSafeInteger(n)) throw new Error("home: a stored figure is out of range");
  return n;
}

function cellValue(cell: Cell): CellValue {
  switch (cell.kind) {
    case "integer":
      return { t: "int", v: safe(cell.num) };
    case "money":
      return { t: "money", minor: safe(cell.num), currency: cell.currency };
    case "quantity":
      return { t: "qty", milli: safe(cell.num), unit: cell.unit };
    case "text":
      return { t: "text", v: cell.txt };
    case "date":
      return { t: "date", v: cell.day };
    case "timestamp":
      return { t: "time", v: cell.at };
    case "null":
      return { t: "null" };
  }
}

const member = (session: Session) => ({ kind: "member", session }) as const;

async function readOnly<T>(session: Session, fn: (c: Client) => Promise<T>): Promise<T> {
  return withTx(await appPool(), member(session), async (c) => {
    await c.query("set transaction read only");
    return fn(c);
  });
}

type Brief = { runId: string; startedAt: Date; asOf: string; totalId: string | null };

// The latest finished watcher run, its business date, and the overdue total already minted for that date.
function latestBrief(session: Session): Promise<Brief | null> {
  return readOnly(session, async (c) => {
    const { rows } = await c.query<{ id: string; started_at: Date; as_of: string | null }>(
      `select r.id, r.started_at, (select s.params->>'as_of' from snap.snapshot s where s.run_id = r.id limit 1) as as_of
         from ops.run r where r.trigger = 'watcher' and r.ended_at is not null order by r.started_at desc limit 1`,
    );
    const run = rows[0];
    if (!run?.as_of) return null;
    const { rows: total } = await c.query<{ id: string }>(
      `select id from snap.snapshot where query_name = 'credit.overdue_total' and params->>'as_of' = $1 order by created_at desc limit 1`,
      [run.as_of],
    );
    return { runId: run.id, startedAt: run.started_at, asOf: run.as_of, totalId: total[0]?.id ?? null };
  });
}

export async function loadHome(session: Session): Promise<OwnerHome> {
  const brief = await latestBrief(session);
  if (brief && !brief.totalId) {
    const scope = { kind: "system", tenantId: session.tenantId } as const; // the brief's own number, not the viewer's
    brief.totalId = (await mintSnapshot(await appPool(), scope, "credit.overdue_total", { as_of: brief.asOf }, brief.runId)).id;
  }
  return readOnly(session, (c) => readHome(c, session, brief));
}

async function readHome(c: Client, session: Session, brief: Brief | null): Promise<OwnerHome> {
  const q = async <R extends object>(sql: string, values: unknown[] = []) => (await c.query<R>(sql, values)).rows;

  const [tenant] = await q<{ name: string }>("select name from ops.tenant");
  const [me] = await q<Member>("select name, role from ops.member where id = $1", [session.memberId]);
  if (!tenant || !me) throw new Error("home: the signed-in member's shop is not readable");
  const findings = await q<{ id: string; kind: string; snapshot_id: string; snapshot_row: number }>(
    "select id, kind, snapshot_id, snapshot_row from ops.finding where status = 'open' order by created_at, snapshot_row",
  );
  const drafts = await q<{ id: string; payload: ReorderPayload; payload_refs: Record<string, CellRef>; status: Draft["status"] }>(
    `select id, payload, payload_refs, status from approval.draft
      where command_type = 'reorder.place' and (status = 'proposed' or updated_at >= $1::timestamptz) order by created_at`,
    [brief?.startedAt ?? null],
  );

  // Every snapshot a figure on the page points into, with all its stored cells.
  const ids = [...new Set([...findings.map((f) => f.snapshot_id), ...(brief?.totalId ? [brief.totalId] : []), ...drafts.flatMap((d) => Object.values(d.payload_refs).map((r) => r.snapshotId))])];
  const snaps = await q<{ id: string; query_name: string; created_at: Date }>("select id, query_name, created_at from snap.snapshot where id = any($1::uuid[])", [ids]);
  const cellRows = await q<CellRow & { snapshot_id: string; row_no: number; col: string }>(
    `select snapshot_id, row_no, col, ${CELL_COLUMNS} from snap.snapshot_cell where snapshot_id = any($1::uuid[])`,
    [ids],
  );
  const byRow = new Map<string, Record<string, Cell>[]>();
  for (const r of cellRows) {
    const rows = byRow.get(r.snapshot_id) ?? [];
    rows[r.row_no] = { ...(rows[r.row_no] ?? {}), [r.col]: cellFromRow(r) };
    byRow.set(r.snapshot_id, rows);
  }
  const queryOf = new Map(snaps.map((s) => [s.id, s.query_name]));
  const cell = (snapshotId: string, row: number, col: string): Cell | undefined => byRow.get(snapshotId)?.[row]?.[col];
  const text = (snapshotId: string, row: number, col: string) => {
    const v = cell(snapshotId, row, col);
    return v?.kind === "text" ? v.txt : "";
  };

  const supplierIds = new Set<string>();
  for (const f of findings) if (f.kind === "price_creep") supplierIds.add(text(f.snapshot_id, f.snapshot_row, "supplier_id"));
  for (const d of drafts) supplierIds.add(d.payload.supplierId);
  const suppliers = new Map(
    (await q<{ id: string; name: string; is_simulated: boolean }>("select id::text, name, is_simulated from books.supplier where id = any($1::uuid[])", [
      [...supplierIds].filter((id) => /^[0-9a-f-]{36}$/.test(id)),
    ])).map((s) => [s.id, { name: supplierName(s.name, s.is_simulated), simulated: s.is_simulated }]),
  );
  const items = new Map(
    (await q<{ id: string; name: string }>("select id::text, name from books.item where id = any($1::uuid[])", [
      drafts.flatMap((d) => d.payload.lines.map((l) => l.itemId)),
    ])).map((i) => [i.id, i.name]),
  );
  const stamps = new Map(
    (await q<{ draft_id: string; at: Date; by: string }>(
      `select distinct on (a.entity_id) a.entity_id::text as draft_id, a.created_at as at, m.name as by
         from audit.audit_log a join ops.member m on m.tenant_id = a.tenant_id and m.id = a.actor_id
        where a.entity = 'approval.draft' and a.entity_id = any($1::uuid[]) and a.action in ('draft.executed', 'draft.rejected', 'draft.stale')
        order by a.entity_id, a.seq desc`,
      [drafts.map((d) => d.id)],
    )).map((s) => [s.draft_id, { by: s.by, at: s.at.toISOString() }]),
  );
  const mayRun = new Set((await q<{ command: string }>("select command from ops.command_authority where role = $1", [me.role])).map((r) => r.command));

  const ref = (l: Localized, snapshotId: string, row: number, col: string): SourceRef => ({ label: l, snapshotId, row: row + 1, col });
  const shown: Finding[] = [];
  let overdueShown = false;
  const ordered = [...findings].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  for (const f of ordered) {
    const [s, r] = [f.snapshot_id, f.snapshot_row];
    switch (f.kind) {
      case "shrinkage":
        shown.push({
          kind: "shelf_gap",
          id: f.id,
          item: text(s, r, "item"),
          books: ref(label("labelStockLedger"), s, r, "expected"),
          shelf: ref(label("labelStockCount"), s, r, "counted"),
        });
        break;
      case "price_creep": {
        const supplier = suppliers.get(text(s, r, "supplier_id")) ?? { name: text(s, r, "supplier"), simulated: true };
        shown.push({
          kind: "price_rise",
          id: f.id,
          item: text(s, r, "item"),
          supplier,
          was: ref(label("labelEarlierBills"), s, r, "baseline_cost"),
          now: ref(label("labelSupplierBill", { en: { supplier: possessive(supplier.name) }, hi: { supplier: supplier.name } }), s, r, "latest_cost"),
        });
        break;
      }
      case "overdue_credit": // one card for all overdue customers, its figures from the brief's credit.overdue_total
        if (overdueShown || !brief?.totalId) break;
        overdueShown = true;
        shown.push({
          kind: "overdue_credit",
          id: f.id,
          customers: ref(label("labelCreditBook"), brief.totalId, 0, "customers"),
          owed: ref(label("labelCreditBook"), brief.totalId, 0, "overdue"),
          days: ref(label("labelCreditBook"), brief.totalId, 0, "credit_days"),
        });
        break;
      case "expiry":
        shown.push({
          kind: "expiry",
          id: f.id,
          item: text(s, r, "item"),
          left: ref(label("labelStockLedger"), s, r, "remaining"),
          days: ref(label("labelPurchaseBill"), s, r, "days_left"),
          value: ref(label("labelStockLedger"), s, r, "at_risk_value"),
        });
        break;
      case "short_settlement":
        shown.push({
          kind: "short_settlement",
          id: f.id,
          day: ref(label("labelUpiSettlement"), s, r, "business_date"),
          short: ref(label("labelUpiSettlement"), s, r, "short"),
        });
        break;
    }
  }

  const cards: Draft[] = drafts.map((d) => ({
    id: d.id,
    command: "reorder.place",
    status: d.status,
    lines: d.payload.lines.map((line, i) => ({
      item: items.get(line.itemId) ?? "",
      qty: qtyRef(d.payload_refs[`lines[${i}].qtyMilli`], line.qtyMilli, cell, queryOf, ref),
    })),
    supplier: suppliers.get(d.payload.supplierId) ?? { name: "", simulated: true },
    decision: stamps.get(d.id) ?? null,
    canDecide: mayRun.has("reorder.place"),
  }));

  const snapshots: Snapshot[] = snaps.map((s) => {
    const view = DRAWER[s.query_name];
    const rows = (byRow.get(s.id) ?? []).map((row) => Object.fromEntries(Object.entries(row).map(([col, v]) => [col, cellValue(v)])));
    const first = rows[0] ?? {};
    const columns: Column[] = (view?.columns ?? Object.keys(first)).map((key) => {
      const v = first[key];
      return { key, numeric: v?.t === "int" || v?.t === "money" || v?.t === "qty" };
    });
    return {
      id: s.id,
      query: s.query_name,
      readAt: s.created_at.toISOString(),
      title: view ? label(view.title) : { en: s.query_name, hi: s.query_name },
      ...(view?.simulatedSupplier ? { simulatedSupplier: true } : {}),
      columns,
      rows,
    };
  });

  const synthetic = /\s*\(synthetic\)$/;
  return {
    shop: { name: tenant.name.replace(synthetic, ""), synthetic: synthetic.test(tenant.name) },
    member: me,
    briefAt: brief ? brief.startedAt.toISOString() : null,
    snapshots,
    findings: shown,
    unverified: UNVERIFIED,
    drafts: cards,
  };
}

type ReorderPayload = { supplierId: string; lines: { itemId: string; qtyMilli: number }[] };

// A reorder line's quantity is shown from its payload ref (the cell core checked holds it when the draft was proposed),
// and only while that stored cell still holds the very quantity the draft would order; otherwise null, and the card says
// "Cannot verify" rather than print the payload.
function qtyRef(
  r: CellRef | undefined,
  qtyMilli: number,
  cell: (snapshotId: string, row: number, col: string) => Cell | undefined,
  queryOf: Map<string, string>,
  ref: (l: Localized, snapshotId: string, row: number, col: string) => SourceRef,
): SourceRef | null {
  const v = r && cell(r.snapshotId, r.row, r.col);
  if (!r || v?.kind !== "quantity" || v.num !== String(qtyMilli)) return null;
  return ref(label(queryOf.get(r.snapshotId) === "watch.shrinkage" ? "labelStockCount" : "labelStockLedger"), r.snapshotId, r.row, r.col);
}
