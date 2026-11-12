// The integration feed (app/api/integrations/v1/feed, core's integration-feed.ts), on the demo kirana with its PayPal step
// (a recorded paid link the books do not show yet). FEED1: only MUNSHI_INTEGRATION_SECRET opens it; anything else, a
// short secret, a malformed or unknown shop are the same bare 404. FEED2: a link's id changes with its state, and every
// amount is a stored cell or a stored row, named by its source. FEED3: reading it writes nothing, and the database itself
// refuses a write in its transaction. FEED4: a real shop's books are never served. Red-proofs:
// db/test/v2/sabotage/integrations.ts.
import type { FeedFinding, FeedLink, FeedPayment, IntegrationFeed } from "@munshi/core/integration";
import { readIntegrationFeed } from "@munshi/core/integration";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { GET } from "../app/api/integrations/v1/feed/route";
import { appPool } from "../lib/server/db";
import { type Home, openHome, rows } from "./helpers/home-db";

const SECRET = "integration-secret-for-the-test-0123456789";
const SHOP = "sharma-general-store";

let h: Home;
beforeAll(async () => {
  h = await openHome();
  await h.db.sabotage();
});
afterAll(() => h.close());
afterEach(() => {
  delete process.env.MUNSHI_INTEGRATION_SECRET;
});

const call = (auth: string | null, shop: string | null = SHOP) =>
  GET(new Request(`http://local/api/integrations/v1/feed${shop === null ? "" : `?shop=${encodeURIComponent(shop)}`}`, { headers: auth ? { authorization: auth } : {} }));

const feed = async (): Promise<IntegrationFeed> => {
  process.env.MUNSHI_INTEGRATION_SECRET = SECRET;
  const res = await call(`Bearer ${SECRET}`);
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  return (await res.json()) as IntegrationFeed;
};

const counts = () =>
  rows<{ snaps: number; drafts: number; decisions: number; audit: number; findings: number }>(
    h,
    `select (select count(*)::int from snap.snapshot) as snaps, (select count(*)::int from approval.draft) as drafts,
            (select count(*)::int from approval.decision) as decisions, (select count(*)::int from audit.audit_log) as audit,
            (select count(*)::int from ai.finding_event) as findings`,
  );

test("FEED1 the route admits only the integration secret, and refuses everything else with a bare 404", async () => {
  const refused = async (res: Response) => {
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  };
  // Unset: no one.
  await refused(await call(`Bearer ${SECRET}`));
  await refused(await call("Bearer "));
  // Set, but short: still no one.
  process.env.MUNSHI_INTEGRATION_SECRET = "short-secret";
  await refused(await call("Bearer short-secret"));
  process.env.MUNSHI_INTEGRATION_SECRET = "";
  await refused(await call("Bearer "));
  process.env.MUNSHI_INTEGRATION_SECRET = SECRET;
  await refused(await call(null));
  await refused(await call("Bearer wrong"));
  await refused(await call(SECRET)); // no scheme
  // The right key, but no such shop, or no shop: the same 404.
  await refused(await call(`Bearer ${SECRET}`, "no-such-shop"));
  await refused(await call(`Bearer ${SECRET}`, "Not A Slug"));
  await refused(await call(`Bearer ${SECRET}`, null));
  expect((await call(`Bearer ${SECRET}`)).status).toBe(200);
});

test("FEED2 links carry their state in their id, and every amount is a stored cell or row with its source", async () => {
  const f = await feed();
  expect(f.shop).toMatchObject({ slug: SHOP, label: "Sample shop: synthetic data" });
  expect(f.shop.dataClass).not.toBe("live");
  expect(f.shop.paypal).toContain("PayPal sandbox");

  // The seeded paid link (recorded mode): PayPal says paid, the books do not show it.
  const stored = await rows<{ id: string; amount_minor: string; currency: string }>(h, "select id::text, amount_minor::text, currency from ops.paypal_link");
  expect(f.links).toHaveLength(stored.length);
  const paid = f.links.find((l) => l.linkId === h.paypal.linkId) as FeedLink;
  expect(paid).toMatchObject({ id: `${h.paypal.linkId}:paid`, state: "paid", mode: "recorded" });
  expect(paid.customer.name).toBe("Sunita P.");
  for (const l of f.links) {
    expect(l.id).toBe(`${l.linkId}:${l.state}`);
    expect(["asked", "sent", "paid", "recorded", "failed", "cancelled"]).toContain(l.state);
    // The link's amount is the stored cell its draft cited, and that is the amount the link asked PayPal for.
    const row = stored.find((s) => s.id === l.linkId);
    expect(l.amount.source?.kind).toBe("snapshot");
    expect(String(l.amount.minor)).toBe(row?.amount_minor);
    expect(l.amount.currency).toBe(row?.currency);
    expect(l.amount.display).toMatch(/^₹[\d,.]+$/);
    const cell = await rows<{ cell: { k: string; n: string } }>(
      h,
      `select s.rows -> $2::int -> (select (c.i - 1)::int from jsonb_array_elements(s.columns) with ordinality c(v, i) where c.v ->> 'n' = $3) as cell
         from snap.snapshot s where s.id = $1`,
      [l.amount.source?.kind === "snapshot" ? l.amount.source.snapshotId : "", l.amount.source?.kind === "snapshot" ? l.amount.source.row : 0, l.amount.source?.kind === "snapshot" ? l.amount.source.col : ""],
    );
    expect(cell[0]?.cell.n).toBe(row?.amount_minor);
  }

  // The payment waiting to be recorded: the stored notification's own amount, named by its row.
  const events = await rows<{ id: string; amount_minor: string; currency: string }>(h, "select id::text, amount_minor::text, currency from ops.payment_event");
  const waiting = f.payments.find((p) => p.linkId === h.paypal.linkId) as FeedPayment;
  const event = events.find((e) => e.id === waiting.eventId);
  expect(waiting.id).toBe(`${waiting.eventId}:unrecorded`);
  expect(waiting.amount).toMatchObject({ minor: Number(event?.amount_minor), currency: event?.currency, source: { kind: "row", table: "ops.payment_event", id: waiting.eventId } });
  expect(waiting.customer.name).toBe("Sunita P.");

  // Findings: the watchers' rows, each impact the stored cell it names.
  const found = await rows<{ id: string }>(h, "select id::text from ai.finding");
  expect(f.findings.length).toBe(Math.min(found.length, 100));
  expect(f.findings.length).toBeGreaterThan(0);
  for (const x of f.findings as FeedFinding[]) {
    expect(["low", "medium", "high", "critical"]).toContain(x.severity);
    if (x.impact) {
      expect(x.impact.source.kind).toBe("snapshot");
      expect(x.impact.display).not.toBe("Cannot verify");
    }
  }
  expect(JSON.stringify(f)).not.toContain("Cannot verify");
});

test("FEED3 reading the feed writes nothing, and its transaction refuses a write", async () => {
  const before = await counts();
  await feed();
  await feed();
  expect(await counts()).toEqual(before);

  // A write tried in the feed's own transaction, just before it commits, is refused by the database as read only.
  const pool = await appPool();
  let refusal: string | undefined;
  const probing = new Proxy(pool, {
    get(target, prop) {
      if (prop !== "connect") return Reflect.get(target, prop, target);
      // pool.query's own connect takes a callback: left as it is (tenantOf's lookup, outside the transaction).
      return async (...cb: unknown[]) => {
        if (cb.length) return (target.connect as (...a: unknown[]) => unknown).apply(target, cb);
        const client = (await target.connect()) as pg.PoolClient;
        return new Proxy(client, {
          get(c, p) {
            if (p !== "query") return Reflect.get(c, p, c);
            return async (...args: unknown[]) => {
              if (args[0] === "commit" && refusal === undefined) {
                refusal = await c.query("update ops.tenant set name = name").then(
                  () => "written",
                  (err: { code?: string }) => err.code ?? "error",
                );
              }
              return (c.query as (...a: unknown[]) => unknown).apply(c, args);
            };
          },
        });
      };
    },
  });
  await readIntegrationFeed(probing as pg.Pool, SHOP).catch(() => null);
  expect(refusal).toBe("25006"); // read_only_sql_transaction
});

test("FEED4 a real shop's books are never served", async () => {
  process.env.MUNSHI_INTEGRATION_SECRET = SECRET;
  const c = await h.db.admin.connect();
  const [{ data_class: was }] = (await c.query<{ data_class: string }>("select data_class from ops.tenant where tenant_id = $1", [h.k.tenantId])).rows as [{ data_class: string }];
  try {
    await c.query("begin");
    await c.query("set local session_replication_role = replica"); // the fixture only: the tenant's guard refuses a class change
    await c.query("update ops.tenant set data_class = 'live' where tenant_id = $1", [h.k.tenantId]);
    await c.query("commit");
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  } finally {
    await c.query("begin; set local session_replication_role = replica");
    await c.query("update ops.tenant set data_class = $2 where tenant_id = $1", [h.k.tenantId, was]);
    await c.query("commit");
    c.release();
  }
});
