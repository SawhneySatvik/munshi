// Every media call is core's to allow (BLUEPRINT §4.6): a bill or shelf photo's vision call, each segment call and a
// voice note's transcription ask the port's allow first, so AI off and the shop's media caps hold on every path; a
// missing key fails by name (no_key) before anything is counted or sent. Fake fetches only, no network.
import type { Cell } from "@munshi/core/read";
import { expect, it } from "vitest";
import { readBill } from "../src/bill.ts";
import type { EvidencePort, TraceEvent } from "../src/port.ts";
import { countShelf } from "../src/shelf.ts";
import { askByVoice } from "../src/voice.ts";
import { env, json, noSleep, queueFetch, responsesBody, wavBytes } from "./helpers.ts";

const live = (e: NodeJS.ProcessEnv = env) => ({ env: e, mode: "live", sleep: noSleep, edition: "meta" }) as const;
const { META_MODEL_API_KEY: _m, ...noMeta } = env;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const row: Record<string, Cell> = { item_id: { kind: "text", txt: "it-1" }, item: { kind: "text", txt: "Glucose biscuits" }, on_hand: { kind: "quantity", num: "24000", unit: "pack" } };
const meta = (text: string) => json(200, responsesBody({ output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }] }));

function port(events: TraceEvent[], allowed: string[], allow: (role: string) => boolean): EvidencePort {
  return {
    async read(name) {
      if (name !== "items.list") throw new Error(`unexpected read ${name}`);
      return { snapshotId: "00000000-0000-4000-8000-000000000001", rows: [row] };
    },
    resolve: async () => null,
    propose: async () => {
      throw new Error("no drafts");
    },
    finding: async () => null,
    trace: (e) => {
      events.push(e);
    },
    allow: async (role) => {
      allowed.push(role);
      return allow(role);
    },
    recordCount: async () => {
      throw new Error("no counts");
    },
    recordBill: async () => {
      throw new Error("no bills");
    },
  };
}

it("MEDIA1 a bill photo's vision call asks allow first: refused, the bill is refused as ai_off and nothing is sent", async () => {
  const events: TraceEvent[] = [];
  const allowed: string[] = [];
  const { f, calls } = queueFetch();
  const r = await readBill(PNG, { port: port(events, allowed, () => false), deps: { ...live(), fetch: f }, supplierId: "9a1b2c3d-0000-4000-8000-000000000002" });
  expect([r, allowed, calls]).toEqual([{ kind: "refused", why: "ai_off" }, ["vision"], []]);
  expect(events.map((e) => e.label)).toEqual(["ai_off", "ai_off"]);
});

it("MEDIA2 with no key for the vision model, a photo fails by name (no_key) before allow is asked", async () => {
  const allowed: string[] = [];
  const { f, calls } = queueFetch();
  const r = await countShelf(PNG, { port: port([], allowed, () => true), deps: { ...live(noMeta), fetch: f } });
  expect([r, allowed, calls]).toEqual([{ kind: "refused", why: "no_key" }, [], []]);
});

it("MEDIA3 each segment call asks allow (segment): refused, the item is uncounted as ai_off and no segment call is made", async () => {
  const events: TraceEvent[] = [];
  const allowed: string[] = [];
  const { f, calls } = queueFetch(meta('{"products":[{"item":"item:1","phrase":"yellow biscuit packet"}]}'));
  const r = await countShelf(PNG, { port: port(events, allowed, (role) => role !== "segment"), deps: { ...live(), fetch: f } });
  expect(r).toEqual({ kind: "counted", counts: [], uncounted: [{ itemId: "it-1", why: "ai_off" }], unrecognised: [] });
  expect([allowed, calls.length]).toEqual([["vision", "segment"], 1]);
});

it("MEDIA4 a voice note asks allow (voice) after the audio and the key are checked: refused, it abstains with no call", async () => {
  const events: TraceEvent[] = [];
  const allowed: string[] = [];
  const { f, calls } = queueFetch();
  const out = await askByVoice(wavBytes(), { port: port(events, allowed, () => false), asOf: "2026-11-02", deps: { ...live(), fetch: f } });
  expect([out.transcript, out.reply.kind, allowed, calls]).toEqual([null, "abstain", ["voice"], []]);
  expect(events.map((e) => e.label)).toEqual(["ai_off", "model_error"]);
  const keyless: string[] = [];
  await askByVoice(wavBytes(), { port: port([], keyless, () => true), asOf: "2026-11-02", deps: { ...live(noMeta), fetch: f } });
  expect([keyless, calls]).toEqual([[], []]);
});
