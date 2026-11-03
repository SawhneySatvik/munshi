// The usage hook (Deps.onUsage), what the spend ledger is written from. A reply whose provider sent no usage is a call
// with no usage (null), so its cost is null ("Cannot verify"), never zero. Every adapter that reports no token usage of
// its own (speech-to-text, segment, a document read) still tells the caller of its one call. Red-proved by hand:
// packages/ai may import nothing outside itself, so it has no sabotage plugin.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { costOf, fixtureKey, generate, type ModelCall, readDocument, segment, sha256Hex, transcribe } from "../src/index.ts";
import { env, json, noSleep, queueFetch, responsesBody, tmpFixtures, wavBytes } from "./helpers.ts";

const heard = () => {
  const calls: ModelCall[] = [];
  return { calls, onUsage: async (c: ModelCall) => void calls.push(c) };
};

describe("usage", () => {
  it("a reply with no usage block is a call with no usage: its cost is null, never zero", async () => {
    const t = heard();
    const { f } = queueFetch(json(200, responsesBody({ usage: undefined })), json(200, responsesBody({ usage: { input_tokens: 11 } })));
    const r = await generate({ role: "reason", messages: [{ role: "user", content: "hi" }] }, { env, fetch: f, mode: "live", sleep: noSleep, onUsage: t.onUsage });
    expect(r.usage).toBeNull();
    await generate({ role: "reason", messages: [{ role: "user", content: "hi" }] }, { env, fetch: f, mode: "live", sleep: noSleep, onUsage: t.onUsage });
    expect(t.calls.map((c) => [c.alias, c.usage])).toEqual([
      ["muse-spark", null],
      ["muse-spark", null], // half a usage block is no usage either
    ]);
    expect(t.calls.map((c) => costOf(c.alias as string, c.usage))).toEqual([null, null]);
  });

  const SAM = `<0f>0<|box;x1=1;y1=1;x2=9;y2=9;w=800;h=600|><|mask;x=0;y=0;data=1,1,~a|>`;
  const cases: { name: string; call: (onUsage: (c: ModelCall) => Promise<void>) => Promise<unknown>; expect: Partial<ModelCall> }[] = [
    {
      name: "transcribe (voice)",
      call: (onUsage) =>
        transcribe({ wav: wavBytes() }, { env, fetch: queueFetch(json(200, { sessionId: "s", transcript: "chai", audioDurationMs: 1, turns: [] })).f, mode: "live", sleep: noSleep, onUsage }),
      expect: { role: "voice", alias: "muse-voice", usage: null, replayed: false },
    },
    {
      name: "segment",
      call: (onUsage) =>
        segment(
          { imageUrl: "data:image/png;base64,AAAA", prompt: { phrase: "packet" } },
          { env, fetch: queueFetch(json(200, responsesBody({ model: "sam-3.1", output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text: SAM, annotations: [] }] }] }))).f, mode: "live", sleep: noSleep, onUsage },
        ),
      expect: { role: "segment", alias: "sam", usage: null, replayed: false },
    },
    {
      // The document reader's job API, replayed from a fixture written here (recorded mode tells the call as replayed).
      name: "readDocument (PDF)",
      call: (onUsage) => {
        const dir = tmpFixtures();
        const pdf = new TextEncoder().encode("%PDF-1.4 test");
        const key = fixtureKey({ kind: "document", provider: "sarvam", model: "sarvam-vision", file: sha256Hex(pdf), language: "en-IN" });
        writeFileSync(join(dir, `${key}.json`), JSON.stringify({ provider: "sarvam", model: "sarvam-vision", latencyMs: 1, complete: true, pages: [{ page: 1, blocks: [{ text: "Tea", box: null }] }] }));
        return readDocument(pdf, "application/pdf", "en-IN", { mode: "recorded", fixturesDir: dir, onUsage });
      },
      expect: { role: "document", alias: "sarvam-vision", usage: null, replayed: true },
    },
  ];
  for (const c of cases) {
    it(`an adapter with no token usage still tells its one call: ${c.name}`, async () => {
      const t = heard();
      await c.call(t.onUsage);
      expect(t.calls).toHaveLength(1);
      expect(t.calls[0]).toMatchObject(c.expect);
    });
  }
});
