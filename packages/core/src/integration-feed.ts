// The integration feed (Zapier, Postman): one shop's PayPal links, the PayPal payments its books do not show yet, and its
// findings, for a server that holds MUNSHI_INTEGRATION_SECRET (apps/web/app/api/integrations/v1/feed). Read only, and
// held to it by the database: the transaction is SET READ ONLY before anything is read, so no command, draft, snapshot
// or any other row can be written here, by this code or by anything it calls. It reads as a watcher does: the shop's
// context and no actor (withTx's system scope), so it can never act as anyone. It mints nothing: every amount is a
// stored row or a stored snapshot cell, shown with its source; one that cannot be traced reads "Cannot verify".
// A real shop's books (data_class 'live') are never served here: those are read only by that shop's own members.
import type pg from 'pg';
import { formatMoney } from './money.ts';
import { customerList } from './views-common.ts';
import { linkState } from './queries-paypal.ts';
import { QUERIES } from './queries.ts';
import { type Cell, CANNOT_VERIFY, type CellRef, formatRef, parseRef, renderCell, resolveRef } from './read.ts';
import { tenantOf } from './logins.ts';
import { withTx } from './session.ts';
import { runReadOnly } from './snapshots.ts';
import { businessDate } from './time.ts';

/** How many rows each list carries at most, newest first. */
export const FEED_LIMIT = 100;

export type FeedSource = { kind: 'snapshot'; ref: string; snapshotId: string; row: number; col: string } | { kind: 'row'; table: string; id: string };
export type FeedAmount = { minor: number | null; currency: string | null; display: string; source: FeedSource | null };
export type FeedImpact = { kind: Cell['kind']; value: string | null; currency: string | null; unit: string | null; display: string; source: FeedSource };

/** The app's own link states (queries-paypal.ts linkState): asked, sent (made, unpaid), paid (PayPal says paid, not
 * yet in the books), recorded, failed, cancelled. */
export type FeedLinkState = 'asked' | 'sent' | 'paid' | 'recorded' | 'failed' | 'cancelled';

export type FeedLink = {
  /** changes with the state, so a link that moves on is a new item to a poller */
  id: string;
  linkId: string;
  state: FeedLinkState;
  purpose: 'credit' | 'invoice' | 'order';
  customer: { id: string; name: string };
  amount: FeedAmount;
  payerUrl: string | null;
  /** 'sandbox' (PayPal's sandbox made it) or 'recorded' (no PayPal call: the demo's recorded mode); null before PayPal */
  mode: 'sandbox' | 'recorded' | null;
  createdAt: string;
  sentAt: string | null;
  paidAt: string | null;
  /** when the link reached this state */
  at: string;
};

export type FeedPayment = {
  id: string;
  eventId: string;
  linkId: string;
  customer: { id: string; name: string };
  amount: FeedAmount;
  reference: string;
  matchesLink: boolean;
  receivedAt: string;
};

export type FeedFinding = {
  id: string;
  desk: string;
  kind: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'snoozed' | 'dismissed' | 'resolved';
  /** the finding's impact cell (money, a quantity or a count), or null when the watcher names none */
  impact: FeedImpact | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type IntegrationFeed = {
  shop: { slug: string; name: string; dataClass: string; label: string; paypal: string };
  readAt: string;
  links: FeedLink[];
  payments: FeedPayment[];
  findings: FeedFinding[];
};

const SAMPLE_LABEL = 'Sample shop: synthetic data';
const PAYPAL_LABEL = 'PayPal sandbox: payments are recorded, never processed by Munshi';

const iso = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString());

function snapshotSource(ref: CellRef): FeedSource {
  return { kind: 'snapshot', ref: formatRef(ref), snapshotId: ref.snapshotId, row: ref.row, col: ref.col };
}

/** A stored cell as an amount: the cell's own digits and currency, rendered as the app renders it. */
function cellAmount(cell: Cell | null, source: FeedSource | null): FeedAmount {
  if (cell?.kind !== 'money') return { minor: null, currency: null, display: CANNOT_VERIFY, source };
  return { minor: Number(cell.num), currency: cell.currency, display: renderCell(cell), source };
}

/** A finding's impact cell as stored, rendered as the app renders it. */
function cellImpact(cell: Cell | null, source: FeedSource): FeedImpact {
  if (!cell || cell.kind === 'null') return { kind: 'null', value: null, currency: null, unit: null, display: CANNOT_VERIFY, source };
  return {
    kind: cell.kind,
    value: 'num' in cell ? cell.num : 'txt' in cell ? cell.txt : 'day' in cell ? cell.day : cell.at,
    currency: cell.kind === 'money' ? cell.currency : null,
    unit: cell.kind === 'quantity' ? cell.unit : null,
    display: renderCell(cell),
    source,
  };
}

/** A stored row's amount column (a provider notification's), formatted only. */
function rowAmount(minor: string | number, currency: string, table: string, id: string): FeedAmount {
  const n = Number(minor);
  return { minor: n, currency, display: formatMoney({ minor: n, currency }), source: { kind: 'row', table, id } };
}

/**
 * The feed of the shop at `slug`, or null when there is no such shop or it is a real shop. Read in one read-only
 * transaction under the shop's context, with no actor.
 */
export async function readIntegrationFeed(pool: pg.Pool, slug: string, now = new Date()): Promise<IntegrationFeed | null> {
  const tenantId = await tenantOf(pool, slug);
  if (!tenantId) return null;
  return withTx(pool, { kind: 'system', tenantId }, async (c) => {
    // First: from here on the database refuses every write in this transaction.
    await c.query('set transaction read only');
    const [shop] = (await runReadOnly(c, 'select name, data_class, time_zone from ops.tenant', [])) as { name: string; data_class: string; time_zone: string }[];
    if (!shop || shop.data_class === 'live') return null;

    // PayPal's tables, where the schema has them (payments-paypal.ts paypalReady asks the same).
    const [{ ready }] = (await runReadOnly(c, `select to_regclass('ops.paypal_link') is not null and to_regclass('ops.payment_event') is not null as ready`, [])) as {
      ready: boolean;
    }[] as [{ ready: boolean }];
    const links = ready
      ? ((await runReadOnly(
          c,
          `select l.id::text as id, l.purpose, l.customer_id::text as customer_id, l.figure, l.mode, l.payer_url,
                  ${linkState('l')} as state, l.created_at, l.sent_at, l.cancelled_at, l.updated_at,
                  (select max(e.received_at) from ops.payment_event e where e.tenant_id = l.tenant_id and e.link_id = l.id) as paid_at
             from ops.paypal_link l
            order by l.updated_at desc, l.id desc
            limit ${FEED_LIMIT}`,
          [],
        )) as {
          id: string;
          purpose: FeedLink['purpose'];
          customer_id: string;
          figure: string;
          mode: FeedLink['mode'];
          payer_url: string | null;
          state: FeedLinkState;
          created_at: Date;
          sent_at: Date | null;
          cancelled_at: Date | null;
          updated_at: Date;
          paid_at: Date | null;
        }[])
      : [];

    // The watcher's own rule (watch.paypal_unrecorded): paid at PayPal by the end of today, in the shop's currency, and no
    // live payment records it. Its SQL, run as a plain read: nothing is minted.
    const unrecorded = QUERIES.get('watch.paypal_unrecorded');
    const payments =
      ready && unrecorded
        ? ((await runReadOnly(c, unrecorded.sql, [businessDate(now, shop.time_zone)])) as {
            event_id: string;
            link_id: string;
            customer_id: string;
            reference: string;
            amount: string;
            currency: string;
            received_at: Date;
            matches_link: string;
          }[])
        : [];

    const findings = (await runReadOnly(
      c,
      `select f.id::text as id, f.desk, f.kind, f.severity, f.status, f.snapshot_id::text as snapshot_id, f.snapshot_row, f.impact_col,
              f.first_seen_at, f.last_seen_at
         from ai.finding f
        order by f.first_seen_at desc, f.id desc
        limit ${FEED_LIMIT}`,
      [],
    )) as {
      id: string;
      desk: string;
      kind: string;
      severity: FeedFinding['severity'];
      status: FeedFinding['status'];
      snapshot_id: string;
      snapshot_row: number;
      impact_col: string | null;
      first_seen_at: Date;
      last_seen_at: Date;
    }[];

    const ids = [...new Set([...links.map((l) => l.customer_id), ...payments.map((p) => p.customer_id)])];
    const names = new Map((ids.length ? await customerList(c, ids) : []).map((p) => [p.id, p.name]));
    const customer = (id: string) => ({ id, name: names.get(id) ?? '' });

    const feedLinks: FeedLink[] = [];
    for (const l of links) {
      // The link's amount: the stored cell its approved draft cited (the guard bound amount_minor to it).
      const ref = parseRef(l.figure);
      const amount = cellAmount(ref ? await resolveRef(c, ref) : null, ref ? snapshotSource(ref) : null);
      const at =
        l.state === 'paid' || l.state === 'recorded' ? l.paid_at : l.state === 'cancelled' ? (l.cancelled_at ?? l.updated_at) : l.state === 'sent' ? l.sent_at : l.created_at;
      feedLinks.push({
        id: `${l.id}:${l.state}`,
        linkId: l.id,
        state: l.state,
        purpose: l.purpose,
        customer: customer(l.customer_id),
        amount,
        payerUrl: l.payer_url,
        mode: l.mode,
        createdAt: iso(l.created_at) as string,
        sentAt: iso(l.sent_at),
        paidAt: iso(l.paid_at),
        at: iso(at ?? l.updated_at) as string,
      });
    }
    feedLinks.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

    const feedPayments: FeedPayment[] = payments
      .map((p) => ({
        id: `${p.event_id}:unrecorded`,
        eventId: p.event_id,
        linkId: p.link_id,
        customer: customer(p.customer_id),
        amount: rowAmount(p.amount, p.currency, 'ops.payment_event', p.event_id),
        reference: p.reference,
        matchesLink: p.matches_link === 'yes',
        receivedAt: iso(p.received_at) as string,
      }))
      .reverse(); // the read is oldest first

    const feedFindings: FeedFinding[] = [];
    for (const f of findings) {
      const ref = f.impact_col ? { snapshotId: f.snapshot_id, row: f.snapshot_row, col: f.impact_col } : null;
      feedFindings.push({
        id: f.id,
        desk: f.desk,
        kind: f.kind,
        severity: f.severity,
        status: f.status,
        impact: ref ? cellImpact(await resolveRef(c, ref), snapshotSource(ref)) : null,
        firstSeenAt: iso(f.first_seen_at) as string,
        lastSeenAt: iso(f.last_seen_at) as string,
      });
    }

    return {
      shop: { slug, name: shop.name, dataClass: shop.data_class, label: SAMPLE_LABEL, paypal: PAYPAL_LABEL },
      readAt: now.toISOString(),
      links: feedLinks,
      payments: feedPayments.slice(0, FEED_LIMIT),
      findings: feedFindings,
    };
  });
}
