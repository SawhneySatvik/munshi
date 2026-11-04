import { describe, expect, it } from "vitest";
import { evidenceOf, parseSegments, promptText, segment } from "../src/providers/meta-sam.ts";
import { assertWav } from "../src/providers/meta-voice.ts";
import { transcribe } from "../src/providers/transcribe.ts";
import { env, json, KEY, noSleep, queueFetch, responsesBody, wavBytes } from "./helpers.ts";

const rec = (id: number, x1: number) => `${id}<|box;x1=${x1};y1=10;x2=${x1 + 50};y2=90;w=800;h=600|><|mask;x=0;y=0;data=122,376,~ab|c|>`;

describe("sam-3.1", () => {
  it("count = matches; ids and boxes parsed, mask kept raw", () => {
    const r = parseSegments(`<0f>${rec(0, 70)},${rec(1, 210)},${rec(2, 350)}`);
    expect(r.matches).toHaveLength(3);
    expect(r.matches[1]).toEqual({ id: 1, box: { x1: 210, y1: 10, x2: 260, y2: 90 }, mask: "x=0;y=0;data=122,376,~ab|c", score: null });
    expect(r.imageSize).toEqual({ width: 800, height: 600 });
  });

  it("reads a live record with include_confidence's score in the box and the mask", () => {
    // A record as sam-3.1 returned it live for "red box" (the mask's data cut short).
    const live = "<0f>0<|box;x1=630;y1=80;x2=730;y2=189;w=800;h=600;c=0.941605806350708|><|mask;x=0;y=0;c=0.941605806350708;data=110,101,~!!!6I#M]'gX|>";
    const r = parseSegments(`${live},${rec(1, 210)}`);
    expect(r.matches).toHaveLength(2);
    expect(r.matches[0]).toMatchObject({ id: 0, box: { x1: 630, y1: 80, x2: 730, y2: 189 }, score: 0.941605806350708 });
    expect(r.matches[1]!.score).toBeNull();
    expect(r.imageSize).toEqual({ width: 800, height: 600 });
  });

  it("empty output is zero matches; junk output is an error", () => {
    expect(parseSegments("").matches).toEqual([]);
    expect(() => parseSegments("sorry, I cannot do that")).toThrow(/expected token format/);
  });

  it("one noun phrase only; boxes use the documented grammar", () => {
    expect(() => promptText({ phrase: "tea, sugar" })).toThrow(/one noun phrase/);
    expect(promptText({ phrase: " red packet " })).toBe("red packet");
    expect(promptText({ boxes: [{ id: 1, x1: 4, y1: 5, x2: 6, y2: 7 }], width: 800, height: 600 })).toBe("<0f>1<|box;x1=4;y1=5;x2=6;y2=7;w=800;h=600|>");
  });

  it("sends input_text + input_image to sam-3.1 on /responses and returns matches", async () => {
    const body = responsesBody({ model: "sam-3.1", output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text: `<0f>${rec(0, 70)},${rec(1, 210)}`, annotations: [] }] }] });
    const { f, calls } = queueFetch(json(200, body));
    const r = await segment({ imageUrl: "data:image/png;base64,AAAA", prompt: { phrase: "red packet" } }, { env, fetch: f, mode: "live", sleep: noSleep });
    expect(r.matches).toHaveLength(2);
    expect(r.model).toBe("sam-3.1");
    expect(calls[0]!.url).toBe("https://api.meta.ai/v1/responses");
    const sent = JSON.parse(String(calls[0]!.init!.body));
    expect(sent.model).toBe("sam-3.1");
    expect(sent.input[0].content.map((c: { type: string }) => c.type)).toEqual(["input_text", "input_image"]);
    expect(sent.input[0].content[0].text).toBe("red packet");
  });
});

describe("muse-voice-transcribe-1.0", () => {
  it("accepts the committed hindi.wav (mono 16-bit 16 kHz)", () => {
    expect(() => assertWav(wavBytes())).not.toThrow();
  });

  it("refuses stereo, wrong rate and non-WAV", () => {
    const stereo = wavBytes().slice();
    new DataView(stereo.buffer).setUint16(22, 2, true);
    expect(() => assertWav(stereo)).toThrow(/mono 16-bit/);
    const r44 = wavBytes().slice();
    new DataView(r44.buffer).setUint32(24, 44100, true);
    expect(() => assertWav(r44)).toThrow(/16 or 24 kHz/);
    expect(() => assertWav(new Uint8Array(100))).toThrow(/not a WAV/);
  });

  it("posts multipart to /v1/asr/transcribe with Bearer auth and returns the transcript", async () => {
    const { f, calls } = queueFetch(json(200, { sessionId: "s", transcript: "दस किलो चीनी", audioDurationMs: 4000, turns: [] }));
    const r = await transcribe({ wav: wavBytes(), language: "Hindi" }, { env, fetch: f, mode: "live", sleep: noSleep });
    expect(r).toMatchObject({ text: "दस किलो चीनी", model: "muse-voice-transcribe-1.0", language: null });
    expect(calls[0]!.url).toBe("https://api.meta.ai/v1/asr/transcribe");
    expect(new Headers(calls[0]!.init!.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    const form = calls[0]!.init!.body as FormData;
    expect(JSON.parse(await (form.get("request") as Blob).text())).toEqual({ mode: "PUSH_TO_TALK", model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", languageBias: ["Hindi"] });
    expect((form.get("audio") as Blob).size).toBe(wavBytes().length);
  });

  it("redacts a key echoed in an error, retries 5xx, surfaces model_not_found", async () => {
    const e1 = queueFetch(new Response(`denied ${KEY}`, { status: 403 }));
    const err = await transcribe({ wav: wavBytes() }, { env, fetch: e1.f, mode: "live", sleep: noSleep }).catch((e) => e);
    expect(String(err.message)).not.toContain(KEY);
    expect(err.status).toBe(403);

    const e2 = queueFetch(json(500, { error: {} }), json(200, { transcript: "ok" }));
    expect((await transcribe({ wav: wavBytes() }, { env, fetch: e2.f, mode: "live", sleep: noSleep })).text).toBe("ok");
    expect(e2.calls).toHaveLength(2);

    const e3 = queueFetch(json(404, { error: { code: "model_not_found" } }));
    const nf = await transcribe({ wav: wavBytes() }, { env, fetch: e3.f, mode: "live", sleep: noSleep }).catch((e) => e);
    expect(nf.code).toBe("model_not_found");
  });
});

describe("the evidence kept for a count", () => {
  it("keeps every box in the form the books' check counts, without masks or scores, within the column's limit", () => {
    const mask = `<|mask;x=0;y=0;c=0.94;data=110,101,~${"a".repeat(2000)}|>`;
    const live = `<0f>${Array.from({ length: 18 }, (_, i) => `${i}<|box;x1=${i};y1=2;x2=30;y2=40;w=800;h=600;c=0.94|>${mask}`).join(",")}`;
    const kept = evidenceOf(live);
    expect(live.length).toBeGreaterThan(20000);
    expect(kept.length).toBeLessThan(20000);
    // ops.shelf_count's check, as written in the schema.
    expect(kept.match(/[0-9]+<\|box;x1=[0-9]+;y1=[0-9]+;x2=[0-9]+;y2=[0-9]+;w=[0-9]+;h=[0-9]+\|>/g)).toHaveLength(18);
    expect(parseSegments(kept).matches.map((m) => m.box)).toEqual(parseSegments(live).matches.map((m) => m.box));
    expect(parseSegments(kept).imageSize).toEqual({ width: 800, height: 600 });
  });
});
