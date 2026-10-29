// Counting a shelf from a photo on /stock, on the demo shop's books and recorded model responses (hero-script.ts). The
// photo is the committed synthetic shelf (packages/agent/fixtures/media/shelf.png: 18 packets of glucose biscuits, 12
// packs of butter, 3 jars of honey the catalogue does not hold). Each counted product shows beside what the books hold
// (both cells), the counting model's own boxes are drawn on the photo, and a gap becomes a stock.count draft that
// changes the books only when a member allowed to count stock approves it, under their name.
import { readFileSync } from "node:fs";
import { mintSnapshot, recordWaste } from "@munshi/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { decidePhotoDraft } from "../app/app/hero-actions";
import { countShelfAction } from "../app/app/stock/photo-actions";
import { LangProvider } from "../components/LangProvider";
import { ShelfPhoto } from "../components/ShelfPhoto";
import { StockBook } from "../components/StockBook";
import type { CountDraft, ShelfState } from "../lib/hero-types";
import { fixturesDir } from "../lib/server/agent-port";
import { photoDrafts } from "../lib/server/hero";
import { loadStock } from "../lib/server/stock";
import { resolveCell } from "../lib/snapshot";
import type { Lang, SourceRef } from "../lib/types";
import { hideNavigatorWhileWriting, prepare, script, type Turn, WRITING } from "./hero-script";
import { type Home, openHome, rows, signInAs } from "./home-db";
import { formOf } from "./ops-db";
import { fakeMatchMedia, unsourced } from "./render";

vi.mock("../lib/server/agent-port", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/server/agent-port")>();
  const { depsFor } = await import("./hero-script");
  return { ...real, agentDeps: (flow: "ask" | "shelf" | "bill") => depsFor(real.agentDeps(flow), real.fixturesDir(flow)) };
});

const media = (name: string) => readFileSync(new URL(`../../../packages/agent/fixtures/media/${name}`, import.meta.url));
const SHELF = media("shelf.png");
const BISCUITS = "Glucose biscuits 70 g";
const BUTTER = "Butter 100 g";

// The segment model's records for the drawn units, from shelf.svg's own rectangles (900 × 640 pixels).
function units(width: number, height: number): string {
  const svg = media("shelf.svg").toString("utf8");
  const boxes = [...svg.matchAll(new RegExp(`<rect x="(\\d+)" y="(\\d+)" width="${width}" height="${height}"`, "g"))].map((m) => [Number(m[1]), Number(m[2])]);
  return `<0f>${boxes.map(([x, y], k) => `${k}<|box;x1=${x};y1=${y};x2=${(x as number) + width};y2=${(y as number) + height};w=900;h=640|><|mask;x=${x};y=${y};data=${width},${height},~M${k}|>`).join(",")}`;
}

let h: Home;
let turns: () => Turn[];
beforeAll(async () => {
  prepare(fixturesDir("shelf"));
  h = await openHome();
  // The catalogue reaches the vision model as handles in items.list order (item:1 is its first row).
  const list = await mintSnapshot(h.db.app, { kind: "member", session: h.k.owner }, "items.list", {});
  const handle = (name: string) => `item:${list.rows.findIndex((r) => r.item?.kind === "text" && r.item.txt === name) + 1}`;
  turns = () => [
    {
      json: {
        products: [
          { item: handle(BISCUITS), phrase: "yellow biscuit packet" },
          { item: handle(BUTTER), phrase: "butter pack" },
          { item: null, phrase: "honey jar" },
        ],
      },
    },
    { text: units(78, 118) },
    { text: units(44, 70) },
  ];
});
afterAll(() => h.close());
beforeEach(() => {
  vi.stubGlobal("matchMedia", fakeMatchMedia(false));
  Object.assign(URL, { createObjectURL: () => "blob:shelf", revokeObjectURL: () => {} }); // jsdom has no object URLs
  hideNavigatorWhileWriting(vi.stubGlobal);
  signInAs(h.k.owner);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  expect(script.turns).toEqual([]);
});

const held = async (name: string) =>
  Number((await rows<{ n: string }>(h, "select coalesce(sum(qty_milli), 0)::text as n from books.stock_move where item_id = $1", [h.k.items.get(name)]))[0]?.n);
const milli = (snapshots: Parameters<typeof resolveCell>[0], ref: SourceRef | null) => {
  const c = ref && resolveCell(snapshots, ref);
  return c?.t === "qty" ? c.milli : null;
};

/** Rejects every count draft still waiting: a repeat of a photo returns the draft it left, so a new reading needs none. */
async function clearWaiting() {
  signInAs(h.k.owner);
  for (const d of await rows<{ id: string }>(h, "select id::text from approval.draft where command = 'stock.count' and status = 'proposed'")) {
    await decidePhotoDraft(null, formOf({ draft: d.id, verdict: "rejected" }));
  }
}

async function count(): Promise<Extract<ShelfState, { result: unknown }>> {
  await clearWaiting();
  if (WRITING) script.turns = turns();
  const form = new FormData();
  form.set("photo", new Blob([SHELF], { type: "image/png" }), "shelf.png");
  const r = await countShelfAction(null, form);
  if (!r || !("result" in r)) throw new Error(`expected a count, got ${JSON.stringify(r)}`);
  return r;
}

async function page(who: Home["k"]["owner"], lang: Lang = "en") {
  signInAs(who);
  const [data, waiting] = await Promise.all([loadStock(who), photoDrafts(who, { waiting: "stock.count" })]);
  return render(
    <LangProvider initial={lang}>
      <StockBook data={data} photo={<ShelfPhoto waiting={waiting} recorded={true} />} />
    </LangProvider>,
  );
}

describe("counting a shelf photo", () => {
  test("through the screen: each product against the books (both cells), the counting model's boxes, a draft for the gap", async () => {
    const books = { biscuits: await held(BISCUITS), butter: await held(BUTTER) };
    expect(books.biscuits).not.toBe(18_000); // the photo shows a gap against the books
    await page(h.k.owner);
    if (WRITING) script.turns = turns();
    fireEvent.change(screen.getByLabelText("Take or choose a photo"), { target: { files: [new File([SHELF], "shelf.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Count this shelf" }));
    const out = (await screen.findByText("What the photo shows", {}, { timeout: 30_000 })).closest(".photo-out") as HTMLElement;
    const card = within(out);
    expect(screen.getByText("Recorded response")).toBeTruthy();
    const rowsShown = [...out.querySelectorAll(".finds .row")];
    expect(rowsShown.map((r) => r.querySelector("[data-name]")?.textContent)).toEqual([BISCUITS, BUTTER]);
    const figures = (row: Element) => [...row.querySelectorAll(".pair .amt")].map((a) => a.textContent);
    const n = (milli: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(milli / 1000);
    expect(figures(rowsShown[0] as Element)).toEqual([n(books.biscuits), "18"]);
    expect(figures(rowsShown[1] as Element)).toEqual([n(books.butter), "12"]);
    // The counting model's own boxes, read back from its stored response: 18 + 12, the gap's in red.
    expect(out.querySelectorAll(".boxed g")).toHaveLength(30);
    expect(out.querySelectorAll(".boxed g.is-gap").length).toBe(18 + (books.butter === 12_000 ? 0 : 12));
    expect(card.getByText("honey jar")).toBeTruthy();
    const drafts = out.querySelectorAll(".photo-draft");
    expect(drafts.length).toBe(books.butter === 12_000 ? 1 : 2);
    expect(within(drafts[0] as HTMLElement).getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(unsourced(document.body)).toEqual([]);
    // Choosing another photo clears this result: no old boxes over a new photo.
    fireEvent.change(screen.getByLabelText("Choose another photo"), { target: { files: [new File([SHELF], "next.png", { type: "image/png" })] } });
    expect(document.querySelector(".shelf-photo .photo-out")).toBeNull();
    expect(document.querySelector(".shelf-photo .boxed g")).toBeNull();
    expect(screen.queryByText("What the photo shows")).toBeNull();
  });

  test("the same photo sent again returns the draft it left waiting: no new run, no new draft; a photo-text note says so", async () => {
    const first = await count();
    if (first.result.kind !== "counted") throw new Error("counted");
    const waiting = first.result.lines.flatMap((l) => (l.draft ? [l.draft.id] : []));
    expect(waiting.length).toBeGreaterThan(0);
    const before = await rows<{ runs: string; drafts: string }>(h, "select (select count(*) from ai.run)::text as runs, (select count(*) from approval.draft)::text as drafts");
    const form = new FormData();
    form.set("photo", new Blob([SHELF], { type: "image/png" }), "shelf.png");
    const again = await countShelfAction(null, form);
    expect(again && "result" in again && again.result.kind === "again" && again.result.drafts.map((d) => d.id)).toEqual(waiting);
    expect(await rows(h, "select (select count(*) from ai.run)::text as runs, (select count(*) from approval.draft)::text as drafts")).toEqual(before);
    // On the screen: the note and the card, and the same draft is not listed twice.
    await page(h.k.owner);
    if (WRITING) script.turns = [];
    fireEvent.change(screen.getByLabelText("Take or choose a photo"), { target: { files: [new File([SHELF], "shelf.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Count this shelf" }));
    await screen.findByText(/You sent this very photo before/, {}, { timeout: 30_000 });
    expect(document.querySelectorAll(`[aria-labelledby="pd-h-${waiting[0]}"]`)).toHaveLength(1);
    // Recorded mode labels the waiting drafts too.
    expect(document.querySelector(".photo-out") && document.querySelectorAll(".photo-draft").length).toBe(waiting.length);
  });

  test("a refused reading in recorded mode says Recorded response; so do the waiting drafts it sits beside", async () => {
    await count(); // leaves drafts waiting
    await page(h.k.owner);
    expect(within(document.querySelector(".photo-waiting") as HTMLElement).getByText("Recorded response")).toBeTruthy();
    cleanup();
    await clearWaiting();
    vi.stubEnv("MUNSHI_EDITION", "paytm");
    try {
      await page(h.k.owner);
      fireEvent.change(screen.getByLabelText("Take or choose a photo"), { target: { files: [new File([SHELF], "shelf.png", { type: "image/png" })] } });
      fireEvent.click(screen.getByRole("button", { name: "Count this shelf" }));
      await screen.findByText("Recorded response", {}, { timeout: 30_000 });
      expect(document.querySelector(".shelf-photo .photo-status .ops-error")).not.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("approving writes the books under the owner; counter staff are not offered it, and the server refuses them", async () => {
    const r = await count();
    if (r.result.kind !== "counted") throw new Error("counted");
    const line = r.result.lines.find((l) => l.item === BISCUITS);
    const draft = line?.draft as CountDraft;
    expect(milli(r.snapshots, draft.counted)).toBe(18_000);
    const [proposed] = await rows<{ run_id: string | null; proposed_by: string | null }>(h, "select run_id::text, proposed_by::text from approval.draft where id = $1", [draft.id]);
    expect(proposed?.run_id).not.toBeNull(); // proposed by the photo's run, as no one
    expect(proposed?.proposed_by).toBeNull();

    const staff = h.k.staff[0] as Home["k"]["owner"];
    expect((await photoDrafts(staff, { ids: [draft.id] })).drafts[0]?.canDecide).toBe(false);
    signInAs(staff);
    expect(await decidePhotoDraft(null, formOf({ draft: draft.id, verdict: "approved" }))).toEqual({ error: "refused" });
    await page(staff);
    const card = document.querySelector(`[aria-labelledby="pd-h-${draft.id}"]`) as HTMLElement;
    expect(within(card).queryByRole("button", { name: "Approve" })).toBeNull();
    expect(card.textContent).toContain("Waiting for someone allowed to approve it.");
    cleanup();

    signInAs(h.k.owner);
    const done = await decidePhotoDraft(null, formOf({ draft: draft.id, verdict: "approved" }));
    if (!done || !("draft" in done)) throw new Error(`expected a decision, got ${JSON.stringify(done)}`);
    expect(done.draft.status).toBe("executed");
    expect(await held(BISCUITS)).toBe(18_000);
    expect(milli(done.snapshots, done.after)).toBe(18_000);
    const [move] = await rows<{ id: string; kind: string; created_by: string }>(
      h,
      "select id::text, kind, created_by::text from books.stock_move where item_id = $1 order by created_at desc limit 1",
      [h.k.items.get(BISCUITS)],
    );
    expect(move).toMatchObject({ kind: "count_adjust", created_by: h.k.owner.memberId });
    const [audit] = await rows<{ actor_id: string }>(h, "select actor_id::text from audit.audit_log where entity = 'books.stock_move' and entity_id = $1", [move?.id]);
    expect(audit?.actor_id).toBe(h.k.owner.memberId);
    expect(done.draft.decision?.by).toBe("Rajesh Sharma");
  });

  test("a count the books moved past goes stale on approval, and changes nothing", async () => {
    const r = await count();
    if (r.result.kind !== "counted") throw new Error("counted");
    const draft = r.result.lines.find((l) => l.item === BUTTER)?.draft ?? r.result.lines.find((l) => l.draft)?.draft;
    if (!draft) throw new Error("a gap draft");
    const name = draft.item;
    await recordWaste(h.db.app, h.k.manager, { itemId: h.k.items.get(name) as string, qtyMilli: 1000 }); // after the photo
    const before = await held(name);
    signInAs(h.k.owner);
    const done = await decidePhotoDraft(null, formOf({ draft: draft.id, verdict: "approved" }));
    expect(done && "draft" in done && done.draft.status).toBe("stale");
    expect(await held(name)).toBe(before);
  });

  test("a photo over the size the server takes is refused on the device, before it is sent", async () => {
    await page(h.k.owner);
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Take or choose a photo"), { target: { files: [big] } });
    const runs = await rows<{ n: string }>(h, "select count(*)::text as n from ai.run");
    fireEvent.click(screen.getByRole("button", { name: "Count this shelf" }));
    expect((await screen.findByText("That photo is too large to send.")).className).toBe("ops-error");
    expect(await rows<{ n: string }>(h, "select count(*)::text as n from ai.run")).toEqual(runs);
  });

  test("a file that is not a still is refused before any model, and nothing is stored", async () => {
    const before = await rows<{ n: string }>(h, "select count(*)::text as n from ops.shelf_count");
    const form = new FormData();
    form.set("photo", new Blob([new TextEncoder().encode("GIF89a not a png")], { type: "image/gif" }), "x.gif");
    const r = await countShelfAction(null, form);
    expect(r && "result" in r && r.result).toEqual({ kind: "refused", why: "not_a_still" });
    expect(await rows<{ n: string }>(h, "select count(*)::text as n from ops.shelf_count")).toEqual(before);
  });

  test("no phrase, name or model word reaches a trace", async () => {
    await count();
    const [run] = await rows<{ id: string }>(h, "select id::text from ai.run where trigger = 'photo' order by started_at desc limit 1");
    const all = JSON.stringify(await rows(h, "select kind, label, ids from ai.trace where run_id = $1", [run?.id]));
    expect(all).toContain("shelf_count");
    for (const word of ["honey", "yellow", "biscuit", "butter", "Glucose"]) expect(all.toLowerCase().includes(word.toLowerCase()), word).toBe(false);
  });

  test("under the second edition (no models set up) the count is refused, never an error", async () => {
    await clearWaiting();
    vi.stubEnv("MUNSHI_EDITION", "paytm");
    try {
      const form = new FormData();
      form.set("photo", new Blob([SHELF], { type: "image/png" }), "shelf.png");
      const r = await countShelfAction(null, form);
      expect(r && "result" in r && r.result).toEqual({ kind: "refused", why: "model_error" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
