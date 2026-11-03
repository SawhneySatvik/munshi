// @vitest-environment node
// The reads of /api/v1, called as Next calls the route handlers, on a real v2 database:
// each GET's happy path and its error table, cursor pages, "tap for source", and the gates the reads carry:
//   - every figure in every GET response is a cell of the latest release, resolves through GET …/refs/… and
//     equals the book row it names (a positive count);
//   - through the API: a snapshot the release does not pin, or another tenant's, is "Cannot verify";
//   - an unverified site answers the one 404, byte-identical to an unknown slug, a malformed parameter, an unknown
//     or malformed order code and an unknown route; once verified it answers;
//   - (GET half) a GET without an Origin is served; one from an origin the site does not list is the 404.
// Red-proofs: db/test/v2/sabotage/api.ts.
import { createHash, randomUUID } from "node:crypto";
import { mintSnapshot, withTx } from "@munshi/core";
import { ERRORS, RefAnswer, Site } from "@munshi/contracts";
import { afterAll, beforeAll, expect, test } from "vitest";
import { GET as unknownGet } from "../../app/api/v1/[...rest]/route";
import { swapApiPorts } from "../../lib/api/deps";
import * as api from "../../lib/api/routes";
import { call, freshIp, type Handler, openWorld, publish, REQUEST_ID, text, tomorrow, verify, type World } from "./fixture";

let w: World;
const A = () => `/api/v1/sites/${w.a.slug}`;

beforeAll(async () => {
  w = await openWorld();
  await w.db.sabotage();
}, 300_000);
afterAll(async () => {
  swapApiPorts({});
  await w?.close();
});

const get = async (handler: Handler, path: string, params: Record<string, string>, query?: Record<string, string>, headers?: Record<string, string>) => {
  const r = await call(handler, path, params, { ...(query ? { query } : {}), ...(headers ? { headers } : {}), ip: freshIp() });
  return { status: r.status, headers: r.headers, json: (await r.json()) as Record<string, unknown> & { data?: Record<string, unknown>[]; next?: string | null } };
};

const NOT_FOUND = JSON.stringify({ error: { code: "not_found", message: ERRORS.not_found.message, fields: [], requestId: REQUEST_ID } });

test("API site: the site, its branches with their hours, the look and the release it was built from; ETag is the release", async () => {
  const r = await get(api.site, A(), { slug: w.a.slug });
  expect(r.status).toBe(200);
  const s = Site.parse(r.json);
  expect(s.slug).toBe(w.a.slug);
  expect(s.label).toBe("Sample site"); // simulated means labelled
  expect(s.bookingMode).toBe("slots");
  expect(s.shops).toHaveLength(1);
  expect(s.shops[0]?.hours).toHaveLength(7);
  expect(s.shops[0]?.hours[0]).toEqual({ day: "mon", closed: false, opens: "09:00", closes: "20:00" });
  expect(s.release.id).toBe(w.a.releaseId);
  expect(s.look.profile.tagline).toEqual({ en: "A sample shop" });
  expect(r.headers.get("etag")).toBe(`"${w.a.releaseId}"`);
  expect(r.headers.get("cache-control")).toBe("public, s-maxage=60");
  expect(r.headers.get("munshi-api-version")).toBe("1");
});

test("API catalogue: goods only, each a variant priced by a release cell; category filter; cursor pages; a bad cursor or limit is invalid", async () => {
  const all = await get(api.catalogue, `${A()}/catalogue`, { slug: w.a.slug });
  expect(all.status).toBe(200);
  const names = all.json.data?.map((i) => i.name);
  expect(names).toEqual(["Cotton saree", "Assam tea 250 g"]);
  const tea = all.json.data?.find((i) => i.name === "Assam tea 250 g") as { variants: { id: string; price: { minor: number; currency: string; ref: string }; held: boolean; unit: string }[] };
  expect(tea.variants[0]).toMatchObject({ id: w.a.items.tea, unit: "pack", held: false, price: { minor: 24_000, currency: "INR" } });
  expect(tea.variants[0]?.price.ref).toMatch(/^⟨snap:/);
  expect(all.json.next).toBeNull();

  const tea2 = await get(api.catalogue, `${A()}/catalogue`, { slug: w.a.slug }, { category: "Tea" });
  expect(tea2.json.data?.map((i) => i.name)).toEqual(["Assam tea 250 g"]);

  const p1 = await get(api.catalogue, `${A()}/catalogue`, { slug: w.a.slug }, { limit: "1" });
  expect(p1.json.data).toHaveLength(1);
  expect(typeof p1.json.next).toBe("string");
  const p2 = await get(api.catalogue, `${A()}/catalogue`, { slug: w.a.slug }, { limit: "1", cursor: p1.json.next as string });
  expect(p2.json.data?.map((i) => i.name)).toEqual(["Assam tea 250 g"]);
  expect(p2.json.next).toBeNull();

  for (const query of [{ cursor: "bm90LWEtY3Vyc29y" }, { limit: "0" }, { limit: "101" }, { limit: "ten" }, { colour: "red" }]) {
    const bad = await get(api.catalogue, `${A()}/catalogue`, { slug: w.a.slug }, query);
    expect(bad.status, JSON.stringify(query)).toBe(400);
    expect((bad.json.error as { code: string }).code).toBe("invalid");
  }
});

test("API services: the service with its duration and price figures, offered at every branch", async () => {
  const r = await get(api.services, `${A()}/services`, { slug: w.a.slug });
  expect(r.status).toBe(200);
  expect(r.json.data).toHaveLength(1);
  expect(r.json.data?.[0]).toMatchObject({ id: w.a.items.haircut, name: "Haircut", duration: { value: 30 }, price: { minor: 35_000, currency: "INR" }, shopIds: [w.a.shopId] });
});

test("API packages: the plan with its price, validity and its lines' sessions", async () => {
  const r = await get(api.packages, `${A()}/packages`, { slug: w.a.slug });
  expect(r.status).toBe(200);
  expect(r.json.data?.[0]).toMatchObject({
    itemId: w.a.items.plan,
    name: "Five haircuts",
    kind: "sessions",
    price: { minor: 150_000 },
    value: null,
    validityDays: { value: 90 },
    lines: [{ serviceId: w.a.items.haircut, name: "Haircut", sessions: { value: 5 } }],
  });
});

test("API offers: the published offer in effect with its code; the unpublished one is not on the site", async () => {
  const r = await get(api.offers, `${A()}/offers`, { slug: w.a.slug });
  expect(r.status).toBe(200);
  expect(r.json.data).toHaveLength(1);
  expect(r.json.data?.[0]).toMatchObject({ id: w.a.offerId, kind: "percent_off", percentBp: { value: 1000 }, minSpend: { minor: 50_000 }, code: "FESTIVE10", scope: "all" });
});

test("API stylists: the opted-in profile, filtered by branch", async () => {
  const r = await get(api.stylists, `${A()}/stylists`, { slug: w.a.slug });
  expect(r.json.data).toEqual([{ id: w.a.staffId, shopId: w.a.shopId, displayName: "Neha", blurb: "Cuts and colour", artUrl: null }]);
  expect((await get(api.stylists, `${A()}/stylists`, { slug: w.a.slug }, { shop: w.a.shopId })).json.data).toHaveLength(1);
  expect((await get(api.stylists, `${A()}/stylists`, { slug: w.a.slug }, { shop: randomUUID() })).json.data).toEqual([]);
  expect((await get(api.stylists, `${A()}/stylists`, { slug: w.a.slug }, { shop: "not-an-id" })).status).toBe(400);
});

test("API slots: tomorrow's free starts, each naming its roster row; a day past 60 days or a missing service is invalid", async () => {
  const r = await get(api.slots, `${A()}/slots`, { slug: w.a.slug }, { shop: w.a.shopId, service: w.a.items.haircut, date: tomorrow() });
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("no-store");
  const slots = r.json.slots as { stylistId: string; shiftRel: string; shiftId: string; start: string }[];
  expect(slots.length).toBe(35); // 10:00–19:00, a 30-minute service on the quarter hours: 10:00 … 18:30
  expect(new Set(slots.map((s) => s.stylistId))).toEqual(new Set([w.a.staffId]));
  expect(slots.every((s) => s.shiftRel === "books.shift_pattern")).toBe(true);
  const far = await get(api.slots, `${A()}/slots`, { slug: w.a.slug }, { shop: w.a.shopId, service: w.a.items.haircut, date: "2099-01-01" });
  expect(far.status).toBe(400);
  expect((await get(api.slots, `${A()}/slots`, { slug: w.a.slug }, { shop: w.a.shopId, date: tomorrow() })).status).toBe(400);
});

test("API ref: a published cell names its book row; any other ref is 200 Cannot verify; a malformed row is the 404", async () => {
  const cat = await get(api.catalogue, `${A()}/catalogue`, { slug: w.a.slug });
  const ref = (((cat.json.data ?? [])[0] as { variants: { price: { ref: string } }[] }).variants[0] as { price: { ref: string } }).price.ref;
  const [, snapshot, row, col] = /^⟨snap:([0-9a-f-]{36})·(\d+)·([a-z_]+)⟩$/.exec(ref) as unknown as string[];
  const r = await get(api.ref, `${A()}/refs/${snapshot}/${row}/${col}`, { slug: w.a.slug, snapshot: snapshot as string, row: row as string, col: col as string });
  expect(r.status).toBe(200);
  const answer = RefAnswer.parse(r.json);
  expect(answer).toMatchObject({ verified: true, cell: { minor: 180_000, currency: "INR", ref }, source: { table: "books.price" } });
  const unverified = { verified: false, label: "Cannot verify" };
  const bRelease = (await w.db.admin.query<{ s: string }>(`select snapshots ->> 'site.catalogue' as s from ops.site_release where id = $1`, [w.b.releaseId])).rows[0]?.s as string;
  for (const [snap, rw, cl] of [
    [randomUUID(), "0", "price"], // no such snapshot
    [snapshot, "99", "price"], // no such row
    [snapshot, row, "no_such_col"],
    [snapshot, row, "unit"], // a text cell names its book row too: verified below
    [bRelease, "0", "price"], // another tenant's release
  ] as [string, string, string][]) {
    const x = await get(api.ref, `${A()}/refs/${snap}/${rw}/${cl}`, { slug: w.a.slug, snapshot: snap, row: rw, col: cl });
    expect(x.status).toBe(200);
    if (cl === "unit") expect(x.json).toMatchObject({ verified: true, cell: { text: "piece" }, source: { table: "books.item", id: w.a.items.saree } });
    else expect(x.json, `${snap} ${rw} ${cl}`).toEqual(unverified);
  }
  const bad = await call(api.ref, `${A()}/refs/${snapshot}/x/${col}`, { slug: w.a.slug, snapshot: snapshot as string, row: "x", col: col as string });
  expect(bad.status).toBe(404);
  expect(await bad.text()).toBe(NOT_FOUND);
});

test("through the API: a display snapshot of the shop (not pinned by a release) is Cannot verify, and the public role cannot read it", async () => {
  const shown = await mintSnapshot(w.db.app, { kind: "member", session: w.a.owner }, "site.catalogue", {});
  const r = await get(api.ref, `${A()}/refs/${shown.id}/0/price`, { slug: w.a.slug, snapshot: shown.id, row: "0", col: "price" });
  expect(r.json).toEqual({ verified: false, label: "Cannot verify" });
  const seen = await withTx(w.db.as("munshi_public"), { kind: "system", tenantId: w.a.tenantId }, (c) =>
    c.query<{ n: number; pinned: number }>(`select count(*)::int as n, count(*) filter (where id = $1)::int as pinned from snap.snapshot`, [shown.id]),
  );
  const releaseSnaps = (await w.db.admin.query<{ n: number }>(`select count(*)::int as n from snap.pin where tenant_id = $1 and holder = 'release'`, [w.a.tenantId])).rows[0]?.n;
  expect(seen.rows[0]).toEqual({ n: releaseSnaps, pinned: 0 });
  expect(releaseSnaps).toBeGreaterThan(0);
});

// Every number a response carries, by path, and where it sits: inside a figure ({minor, ref}, {value, ref}), a derived
// figure ({minor, from}) or the caller's echoed quantity; anything else is bare.
function numbers(v: unknown, at = "$", parent?: Record<string, unknown>): { at: string; bare: boolean }[] {
  if (typeof v === "number") {
    const inFigure = !!parent && ("ref" in parent || "from" in parent || parent.source === "request");
    return [{ at, bare: !inFigure }];
  }
  if (Array.isArray(v)) return v.flatMap((x, i) => numbers(x, `${at}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => numbers(x, `${at}.${k}`, v as Record<string, unknown>));
  return [];
}
function refsIn(v: unknown): { ref: string; minor?: number; value?: number }[] {
  if (Array.isArray(v)) return v.flatMap(refsIn);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const own = typeof o.ref === "string" ? [{ ref: o.ref, ...(typeof o.minor === "number" ? { minor: o.minor } : {}), ...(typeof o.value === "number" ? { value: o.value } : {}) }] : [];
    return [...own, ...Object.values(o).flatMap(refsIn)];
  }
  return [];
}

// The book column each figure's source names.
const BOOK_COLUMN: Record<string, Record<string, string>> = {
  "books.price": { price: "amount_minor" },
  "books.item_revision": { duration_min: "duration_min" },
  "books.package_plan": { validity_days: "validity_days", value: "value_minor" },
  "books.package_plan_line": { sessions: "sessions" },
  "books.offer": { percent_bp: "percent_bp", min_spend: "min_spend_minor", amount_off: "amount_off_minor" },
};

test("every figure in every GET response is a release cell that resolves through its ref and equals the book row it names", async () => {
  const responses = [
    await get(api.site, A(), { slug: w.a.slug }),
    await get(api.catalogue, `${A()}/catalogue`, { slug: w.a.slug }),
    await get(api.services, `${A()}/services`, { slug: w.a.slug }),
    await get(api.packages, `${A()}/packages`, { slug: w.a.slug }),
    await get(api.offers, `${A()}/offers`, { slug: w.a.slug }),
    await get(api.stylists, `${A()}/stylists`, { slug: w.a.slug }),
  ];
  const bare = responses.flatMap((r, i) => numbers(r.json).filter((n) => n.bare).map((n) => `${i}: ${n.at}`));
  expect(bare).toEqual([]);
  const refs = responses.flatMap((r) => refsIn(r.json));
  const pinned = new Set(
    Object.values((await w.db.admin.query<{ s: Record<string, string> }>("select snapshots as s from ops.site_release where id = $1", [w.a.releaseId])).rows[0]?.s ?? {}),
  );
  let checked = 0;
  for (const f of refs) {
    const [, snapshot, row, col] = /^⟨snap:([0-9a-f-]{36})·(\d+)·([a-z_]+)⟩$/.exec(f.ref) as unknown as [string, string, string, string];
    expect(pinned.has(snapshot), f.ref).toBe(true);
    const r = RefAnswer.parse((await get(api.ref, `${A()}/refs/${snapshot}/${row}/${col}`, { slug: w.a.slug, snapshot, row, col })).json);
    if (!r.verified) throw new Error(`S3: ${f.ref} does not verify`);
    const shown = f.minor ?? f.value;
    const cell = r.cell as { minor?: number; value?: number };
    expect(cell.minor ?? cell.value, f.ref).toBe(shown);
    const column = BOOK_COLUMN[r.source.table]?.[col];
    if (!column) throw new Error(`S3: no book column for ${r.source.table} ${col}`);
    const book = (await w.db.admin.query<{ v: string }>(`select ${column}::text as v from ${r.source.table} where tenant_id = $1 and id = $2`, [w.a.tenantId, r.source.id])).rows[0];
    expect(Number(book?.v), `${f.ref} = ${r.source.table}.${column}`).toBe(shown);
    checked++;
  }
  console.log(`S3 checked ${checked} figures against their book rows`);
  expect(checked).toBeGreaterThanOrEqual(8);
});

test("an unverified site, an unknown slug, a malformed slug or parameter, an unknown or malformed order code and an unknown route answer the same bytes; verified, the site answers", async () => {
  const answers = [
    await call(api.site, "/api/v1/sites/nobody-here", { slug: "nobody-here" }),
    await call(api.site, `/api/v1/sites/${w.b.slug}`, { slug: w.b.slug }),
    await call(api.catalogue, `/api/v1/sites/${w.b.slug}/catalogue`, { slug: w.b.slug }),
    await call(api.site, "/api/v1/sites/Not_A_Slug", { slug: "Not_A_Slug" }),
    await call(api.orderStatus, `${A()}/orders/ORD-ZZZZZZ`, { slug: w.a.slug, code: "ORD-ZZZZZZ" }),
    await call(api.orderStatus, `${A()}/orders/ord-1`, { slug: w.a.slug, code: "ord-1" }),
    await call(api.media, `${A()}/media/${randomUUID()}.jpg`, { slug: w.a.slug, file: `${randomUUID()}.jpg` }),
    await call(api.media, `${A()}/media/nothing.gif`, { slug: w.a.slug, file: "nothing.gif" }),
    await call(api.stylists, `${A()}/stylists`, { slug: w.a.slug }, { headers: { origin: "https://elsewhere.example" } }),
    await call(unknownGet, "/api/v1/findings", { rest: ["findings"] }),
    await call(unknownGet, `${A()}/nothing`, { rest: ["sites", w.a.slug, "nothing"] }),
  ];
  const seen = await Promise.all(answers.map(text));
  const first = seen[0] as Awaited<ReturnType<typeof text>>;
  expect(first.status).toBe(404);
  expect(first.body).toBe(NOT_FOUND);
  for (const [i, s] of seen.entries()) expect(s, `answer ${i}`).toEqual(first);

  await verify(w, w.b.tenantId);
  const now = await call(api.site, `/api/v1/sites/${w.b.slug}`, { slug: w.b.slug });
  expect(now.status).toBe(200);
  expect(((await now.json()) as { name: string }).name).toContain("API-B");
  await verify(w, w.b.tenantId, false);
  expect((await call(api.site, `/api/v1/sites/${w.b.slug}`, { slug: w.b.slug })).status).toBe(404);
});

test("(GET half) a GET without an Origin is served, and one from the site's own origin carries its CORS header", async () => {
  const plain = await call(api.site, A(), { slug: w.a.slug });
  expect(plain.status).toBe(200);
  expect(plain.headers.get("access-control-allow-origin")).toBeNull();
  const own = await call(api.site, A(), { slug: w.a.slug }, { headers: { origin: w.a.origin } });
  expect(own.status).toBe(200);
  expect(own.headers.get("access-control-allow-origin")).toBe(w.a.origin);
});

test("(media half) the route serves an art document the release's look names, from the store, only as its own kind; anything else is the 404", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
  const docId = randomUUID();
  const photoId = randomUUID();
  const photo = Buffer.from("a photo's bytes, not published");
  await withTx(w.db.app, { kind: "member", session: w.a.owner }, async (c) => {
    for (const [id, kind, mime, bytes] of [
      [docId, "art", "image/svg+xml", svg],
      [photoId, "photo", "image/jpeg", photo],
    ] as const) {
      await c.query(`insert into ops.document (tenant_id, id, kind, source, storage_key, sha256, mime, bytes) values ($1, $2, $3, 'seed', $4, $5, $6, $7)`, [
        w.a.tenantId,
        id,
        kind,
        `t-${w.a.tenantId}/${id}`,
        createHash("sha256").update(bytes).digest(),
        mime,
        bytes.length,
      ]);
    }
    await c.query(`insert into ops.site_look (tenant_id, site_id, tokens, font_pair, art) values ($1, $2, '{"--ground": "#ffffff"}', 'inter', $3)`, [
      w.a.tenantId,
      w.a.siteId,
      JSON.stringify({ hero: docId }),
    ]);
  });
  const releaseId = await publish(w.db, w.a.tenantId, w.a.siteId);
  swapApiPorts({ media: { read: async (k) => (k === `t-${w.a.tenantId}/${docId}` ? svg : k === `t-${w.a.tenantId}/${photoId}` ? photo : null) } });
  try {
    const site = Site.parse((await get(api.site, A(), { slug: w.a.slug })).json);
    expect(site.release.id).toBe(releaseId);
    expect(site.look.art).toEqual({ hero: `/api/v1/sites/${w.a.slug}/media/${docId}.svg` });
    const ok = await call(api.media, `${A()}/media/${docId}.svg`, { slug: w.a.slug, file: `${docId}.svg` });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/svg+xml");
    expect(ok.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(Buffer.from(await ok.arrayBuffer()).equals(svg)).toBe(true);
    for (const file of [`${docId}.jpg`, `${photoId}.jpg`, `${photoId}.svg`]) {
      const no = await call(api.media, `${A()}/media/${file}`, { slug: w.a.slug, file });
      expect(no.status, file).toBe(404);
      expect(await no.text()).toBe(NOT_FOUND);
    }
    // Under shop B's slug the document is not B's: the 404 (B is verified for the call).
    await verify(w, w.b.tenantId);
    const other = await call(api.media, `/api/v1/sites/${w.b.slug}/media/${docId}.svg`, { slug: w.b.slug, file: `${docId}.svg` });
    expect(other.status).toBe(404);
    await verify(w, w.b.tenantId, false);
  } finally {
    swapApiPorts({});
  }
});

test("API rate limit: a GET past 120 from one IP in a minute is 429 with Retry-After", async () => {
  // At most two minute windows pass in 241 calls, so one of them sees its 121st.
  let limited: Response | undefined;
  let n = 0;
  for (; n < 241 && !limited; n++) {
    const r = await call(api.site, A(), { slug: w.a.slug }, { ip: "192.0.2.77" });
    if (r.status === 429) limited = r;
    else expect(r.status).toBe(200);
  }
  expect(limited, "no 429 in 241 calls").toBeDefined();
  expect(n).toBeGreaterThan(120);
  expect(Number(limited?.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(((await (limited as Response).json()) as { error: { code: string } }).error.code).toBe("rate_limited");
});
