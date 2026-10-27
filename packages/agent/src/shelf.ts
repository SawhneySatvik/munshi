// Shelf count (MS-8). The vision model (role `vision`, no tools) names the distinct products on a shelf photo against
// the shop's catalogue (items.list, shown as handles); a product it cannot place in the catalogue is "unrecognised".
// The segment model (role `segment`) then finds every unit of ONE product per request, by a noun phrase; the count is
// its number of matches, and no model counts or subtracts. The raw response, its sha256 and the photo's sha256 are
// stored through core (port.recordCount), and the count comes back as a cell of count.shelf. Plain code compares that
// cell with the books' on-hand cell; where they differ, a stock.count draft cites both, and a person decides.
import type { CellRef } from "@munshi/core/read";
import { z } from "zod";
import { dataUrl, look, mint, num, type PhotoOptions, ref, stillType, traced, txt } from "./photo.ts";
import { sha256Hex } from "./providers/fixtures.ts";
import { promptText, segment } from "./providers/meta-sam.ts";
import { ModelError } from "./providers/redact.ts";
import { Handles } from "./tools.ts";

export type ShelfCount = {
  itemId: string;
  countId: string;
  /** the counted cell (count.shelf) and the books' cell (stock.on_hand): the screen shows both, never their difference */
  counted: CellRef;
  onHand: CellRef;
  gap: boolean;
  draftId: string | null;
};
export type Uncounted = { itemId: string; why: "not_countable" | "not_one_phrase" | "no_matches" | "model_error" | "refused" };
export type ShelfResult =
  | {
      kind: "counted";
      counts: ShelfCount[];
      uncounted: Uncounted[];
      /** the vision model's phrases for products outside the catalogue: untrusted model text, never a number source */
      unrecognised: string[];
    }
  | { kind: "refused"; why: "not_a_still" | "model_error" | "tool_call" };

const Named = z.object({ products: z.array(z.object({ item: z.string().nullable(), phrase: z.string() })).max(12) });

const NAME_PRODUCTS = [
  "You look at one photo of a shop's shelf and name the distinct products on it. The shop's catalogue comes with the photo, one item a line, each with a handle such as item:1.",
  "For each distinct product you see, give the handle of the catalogue item it is, or null if it is none of them, and a short noun phrase for how one unit of it looks (its colour and kind, such as \"yellow biscuit packet\"): one thing, no list.",
  "Name each product once. Do not count anything.",
].join("\n");

const COUNTABLE = new Set(["pack", "piece"]);

export async function countShelf(photo: Uint8Array, o: PhotoOptions): Promise<ShelfResult> {
  const mime = stillType(photo);
  if (!mime) {
    await traced(o, "abstain", "not_a_still");
    return { kind: "refused", why: "not_a_still" };
  }
  const imageUrl = dataUrl(mime, photo);
  const photoSha256 = sha256Hex(photo);

  const catalogue = await mint(o, "items.list", {});
  const handles = new Handles();
  const countable = new Map<string, boolean>();
  const lines: string[] = [];
  for (const row of catalogue.rows) {
    const itemId = txt(row.item_id);
    if (!itemId) continue;
    countable.set(itemId, row.on_hand?.kind === "quantity" && COUNTABLE.has(row.on_hand.unit));
    lines.push(`${handles.show("item", itemId)} ${txt(row.item) ?? ""}`);
  }
  const seen = await look(o, {
    messages: [
      { role: "system", content: NAME_PRODUCTS },
      { role: "user", content: `Catalogue:\n${lines.join("\n")}`, imageUrl },
    ],
    schema: { name: "shelf", zod: Named },
  });
  if (seen === "tool_call" || seen === "model_error") {
    await traced(o, "abstain", seen);
    return { kind: "refused", why: seen };
  }

  const counts: ShelfCount[] = [];
  const uncounted: Uncounted[] = [];
  const unrecognised: string[] = [];
  const named = new Set<string>();
  for (const p of (seen.json as z.infer<typeof Named>).products) {
    const itemId = p.item === null ? undefined : handles.id("item", p.item);
    if (!itemId) {
      unrecognised.push(p.phrase);
      continue;
    }
    if (named.has(itemId)) continue;
    named.add(itemId);
    if (!countable.get(itemId)) {
      uncounted.push({ itemId, why: "not_countable" }); // loose goods are weighed, not counted
      continue;
    }
    try {
      promptText({ phrase: p.phrase });
    } catch {
      uncounted.push({ itemId, why: "not_one_phrase" });
      continue;
    }
    const t0 = (o.now ?? Date.now)();
    let found: Awaited<ReturnType<typeof segment>>;
    try {
      found = await segment({ imageUrl, prompt: { phrase: p.phrase } }, o.deps);
      await traced(o, "model", "segment", [], t0);
    } catch (err) {
      if (!(err instanceof ModelError)) throw err;
      await traced(o, "model", "model_error", [], t0);
      uncounted.push({ itemId, why: "model_error" });
      continue;
    }
    // Seen by the vision model but not found by the segment model: no count to stand behind.
    if (found.matches.length === 0) {
      uncounted.push({ itemId, why: "no_matches" });
      continue;
    }
    let countId: string;
    try {
      countId = await o.port.recordCount({
        itemId,
        photoSha256,
        phrase: p.phrase,
        model: found.model,
        raw: found.raw,
        rawSha256: found.rawSha256,
        matches: found.matches.length,
      });
    } catch {
      await traced(o, "evidence", "refused");
      uncounted.push({ itemId, why: "refused" });
      continue;
    }
    await traced(o, "evidence", "shelf_count", [countId]);
    counts.push(await compare(o, itemId, countId));
  }
  return { kind: "counted", counts, uncounted, unrecognised };
}

// The count's cell against the books' cell, by plain code; a difference becomes a stock.count draft citing both.
async function compare(o: PhotoOptions, itemId: string, countId: string): Promise<ShelfCount> {
  const count = await mint(o, "count.shelf", { count_id: countId });
  const held = await mint(o, "stock.on_hand", { item_id: itemId });
  const counted = ref(count.snapshotId, 0, "counted");
  const onHand = ref(held.snapshotId, 0, "on_hand");
  const shelf = num(count.rows[0]?.counted);
  const books = num(held.rows[0]?.on_hand);
  if (shelf === null || books === null || shelf === books) return { itemId, countId, counted, onHand, gap: false, draftId: null };
  const t0 = (o.now ?? Date.now)();
  const draftId = await o.port.propose({
    command: "stock.count",
    payload: { itemId, countedQtyMilli: shelf, expectedQtyMilli: books },
    basedOn: [ref(count.snapshotId, 0, "item_id"), counted, onHand],
    payloadRefs: { countedQtyMilli: counted, expectedQtyMilli: onHand },
  });
  await traced(o, "propose", "stock.count", [draftId], t0);
  return { itemId, countId, counted, onHand, gap: true, draftId };
}
