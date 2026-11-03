// The owner home's reads (apps/web/lib/server/home.ts shows them): the latest brief, its open findings, the reorder drafts
// and the agents' other drafts (a finding's fix, a reply: TRAY_COMMANDS) waiting or decided since the brief, and every
// snapshot a figure on the page points into, with all its stored cells.
// The brief's overdue-credit total is minted once per business date: the app mints only as an active member (v2's
// snap_check), so the first member to open the home that day mints it, as a display read.
// By role (D-082, read-roles.ts): the brief is the owner's and a manager's; a finding shows only to a member who may read
// its watcher (counter staff: the stock findings); counter staff see only their own drafts (theirs, or their runs').
import { paypalMessage } from './commands-messaging.ts';
import { askerIn, OFFICE_ROLES } from './read-roles.ts';
import type { CellRef } from './read.ts';
import type { Session } from './session.ts';
import { WATCHERS } from './watchers.ts';
import {
  type Client,
  customerList,
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
/** The other drafts an agent leaves in the tray: a finding's fix (a reminder, a package lapsed) or a reply to a message. */
export const TRAY_COMMANDS = ['customer.remind', 'package.expire', 'message.reply'] as const;
/** And stock near its expiry offered to a recipient (W2-B's Offer it): surplus is the office's, and the office sees every draft. */
export const SURPLUS_TRAY = ['surplus.give'] as const;
/** And a PayPal link (D-079, sandbox): a finding's second fix for overdue udhaar, or a person's own "Send PayPal link". */
export const PAYPAL_TRAY = ['paypal.request'] as const;
export type TrayDraft = {
  id: string;
  command: (typeof TRAY_COMMANDS)[number] | (typeof SURPLUS_TRAY)[number] | (typeof PAYPAL_TRAY)[number];
  payload: Record<string, unknown>;
  basedOn: CellRef[];
  /** the cell each number of the payload came from (a gift's quantity) */
  payloadRefs: Record<string, CellRef>;
  status: HomeDraft['status'];
  /** who it reaches (a reminder, a reply), by name; null for none or a name the books no longer hold */
  customer: string | null;
  /** a reply's words as stored, each figure a ref token; null for the others, or words since erased */
  body: string | null;
  /** a PayPal link's WhatsApp message (paypal_link): the words its approval writes, slots unfilled ({shop} the shop,
   * {amount} the cited cell, {link} `where`), from the very link the draft names; null when that link is not there */
  paypalMessage?: { template: string; shop: string; where: string } | null;
  /** a PayPal link draft's or message's purpose: a customer's balance, or an invoice's open credit */
  paypalPurpose?: 'credit' | 'invoice';
};
export type HomeView = {
  viewer: Viewer;
  /** the named reads this member may make now (read-roles.ts): the moves a finding offers follow them */
  reads: ReadonlySet<string>;
  /** of those, the reads this member sees whole (no column cut): only such a finding is offered Why? or a fix */
  whole: ReadonlySet<string>;
  brief: { runId: string; startedAt: Date; asOf: string; totalId: string | null } | null;
  findings: HomeFinding[];
  drafts: HomeDraft[];
  tray: TrayDraft[];
  /** the shop's recipients (simulated, every one), for "Offer it"; empty for a role surplus is not for (read-roles.ts) */
  recipients: { id: string; name: string }[];
  snapshots: StoredSnapshot[];
  suppliers: Map<string, { name: string; simulated: boolean }>;
  items: Map<string, string>;
  stamps: Map<string, { by: string; at: string }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function viewHome(c: Client, session: Session): Promise<HomeView> {
  const me = await viewer(c, session);
  const asker = await askerIn(c);
  const reads = asker?.reads ?? new Set<string>();
  const whole = asker?.whole ?? new Set<string>();
  const latest = reads.has('brief.ranked') ? await latestBrief(c) : null;
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
      "select id::text, kind, snapshot_id::text, snapshot_row from ai.finding where status = 'open' and kind = any($1::text[]) order by created_at, snapshot_row",
      [WATCHERS.filter((w) => reads.has(w.query)).map((w) => w.kind)],
    )
  ).map((f) => ({ id: f.id, kind: f.kind, snapshotId: f.snapshot_id, snapshotRow: f.snapshot_row }));
  // Every draft for the office; for counter staff, only those they proposed or a run of theirs did.
  const everyone = (OFFICE_ROLES as readonly string[]).includes(me.member.role);
  const mine = (all: string, member: string) =>
    `(${all}::boolean or d.proposed_by = ${member}::uuid
      or exists (select 1 from ai.run r where r.tenant_id = d.tenant_id and r.id = d.run_id and r.started_by = ${member}::uuid))`;
  const drafts = (
    await read<{ id: string; payload: HomeDraft['payload']; payload_refs: Record<string, CellRef>; status: HomeDraft['status'] }>(
      c,
      `select d.id::text, d.payload, d.payload_refs, d.status from approval.draft d
        where d.command = 'reorder.place' and (d.status = 'proposed' or d.updated_at >= $1::timestamptz) and ${mine('$2', '$3')}
        order by d.created_at`,
      [brief?.startedAt ?? null, everyone, session.memberId],
    )
  ).map((d) => ({ id: d.id, payload: d.payload, payloadRefs: d.payload_refs, status: d.status }));
  const others = await read<{
    id: string;
    command: TrayDraft['command'];
    payload: Record<string, unknown>;
    based_on: CellRef[];
    payload_refs: Record<string, CellRef>;
    status: HomeDraft['status'];
    body: string | null;
  }>(
    c,
    `select d.id::text, d.command, d.payload, d.based_on, d.payload_refs, d.status, t.body from approval.draft d
       left join ops.message_text t on t.tenant_id = d.tenant_id and d.command = 'message.reply' and t.id::text = d.payload->>'textId' and t.erased_at is null
      where d.command = any($2::text[]) and (d.status = 'proposed' or d.updated_at >= $1::timestamptz) and ${mine('$3', '$4')} order by d.created_at`,
    [brief?.startedAt ?? null, [...TRAY_COMMANDS, ...SURPLUS_TRAY, ...PAYPAL_TRAY], everyone, session.memberId],
  );
  const customerIds = others.map((d) => d.payload.customerId).filter((id): id is string => typeof id === 'string' && UUID.test(id));
  const customers = new Map((customerIds.length ? await customerList(c, customerIds) : []).map((p) => [p.id, p.name]));
  // A PayPal link message's words come from the very link its draft names (payload.linkId), whatever its state now.
  const linkOf = async (d: (typeof others)[number]) => {
    if (d.command !== 'customer.remind' || d.payload.template !== 'paypal_link') return undefined;
    const linkId = typeof d.payload.linkId === 'string' && UUID.test(d.payload.linkId) ? d.payload.linkId : null;
    const [l] = linkId
      ? await read<{ purpose: 'credit' | 'invoice'; paypal_id: string | null; payer_url: string | null; mode: string | null }>(
          c,
          'select purpose, paypal_id, payer_url, mode from ops.paypal_link where id = $1',
          [linkId],
        )
      : [];
    if (!l?.paypal_id || !l.mode) return { paypalMessage: null };
    return {
      paypalMessage: { ...paypalMessage({ purpose: l.purpose, paypalId: l.paypal_id, payerUrl: l.payer_url, mode: l.mode }), shop: me.tenantName },
      paypalPurpose: l.purpose,
    };
  };
  const tray: TrayDraft[] = [];
  for (const d of others) {
    const paypal = await linkOf(d);
    tray.push({
      id: d.id,
      command: d.command,
      payload: d.payload,
      basedOn: d.based_on,
      payloadRefs: d.payload_refs,
      status: d.status,
      customer: customers.get(d.payload.customerId as string) ?? null,
      body: d.body,
      ...(paypal ?? {}),
      ...(d.command === 'paypal.request' ? { paypalPurpose: d.payload.purpose === 'invoice' ? ('invoice' as const) : ('credit' as const) } : {}),
    });
  }

  const ids = [
    ...findings.map((f) => f.snapshotId),
    ...(brief?.totalId ? [brief.totalId] : []),
    ...drafts.flatMap((d) => Object.values(d.payloadRefs).map((r) => r.snapshotId)),
    ...tray.flatMap((d) => [...d.basedOn, ...Object.values(d.payloadRefs)].map((r) => r.snapshotId)),
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
    reads,
    whole,
    brief,
    findings,
    drafts,
    tray,
    recipients: reads.has('surplus.recipients') ? await read<{ id: string; name: string }>(c, 'select id::text, name from ops.surplus_recipient order by name, id') : [],
    snapshots,
    suppliers: new Map(suppliers.map((s) => [s.id, { name: s.name, simulated: s.simulated }])),
    items: new Map(items.map((i) => [i.id, i.name])),
    stamps: await draftStamps(c, [...drafts, ...tray].map((d) => d.id)),
  };
}
