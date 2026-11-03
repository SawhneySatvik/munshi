// The photo flows' plain code on its own: which bytes count as a still, how a printed figure becomes a whole number,
// and that the segment model's raw response comes back with its sha256 taken on arrival. The flows over the database
// (counts, bills, drafts, traces) are db/test/v2/core/hero/h1-shelf-count.test.ts and h2-bill-read.test.ts.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { printed } from "../src/bill.ts";
import { stillType } from "../src/photo.ts";
import { segment } from "@munshi/ai";
import { env, json, noSleep, queueFetch, responsesBody } from "./helpers.ts";

const media = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/media/${name}`, import.meta.url)));

describe("photo flows", () => {
  it("a still is a PNG or a JPEG by its first bytes; anything else is not sent", () => {
    expect(stillType(media("shelf.png"))).toBe("image/png");
    expect(stillType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe("image/jpeg");
    expect(stillType(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(stillType(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBeNull(); // an MP4
    expect(stillType(new Uint8Array())).toBeNull();
  });

  it("a printed figure becomes whole milli-units or paise by string, never by floating point; anything else is unreadable", () => {
    expect(printed("8.50", 2)).toBe(850);
    expect(printed("62", 2)).toBe(6200);
    expect(printed("1,332.00", 2)).toBe(133_200);
    expect(printed("0.1", 2)).toBe(10);
    expect(printed("₹ 62.00", 2)).toBe(6200);
    expect(printed("48", 3)).toBe(48_000);
    expect(printed("1.5", 3)).toBe(1500);
    for (const bad of ["8.505", "Rs 62", "-4", "12 pcs", "", "1e3"]) expect(printed(bad, 2), bad).toBeNull();
  });

  it("the segment model's raw response comes back as it arrived, with its sha256", async () => {
    const text = "<0f>0<|box;x1=1;y1=2;x2=3;y2=4;w=10;h=10|><|mask;x=1;y=2;data=3,3,~AA|>";
    const body = responsesBody({ model: "sam-3.1", output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }] });
    const { f } = queueFetch(json(200, body));
    const r = await segment({ imageUrl: "data:image/png;base64,AAAA", prompt: { phrase: "yellow biscuit packet" } }, { env, fetch: f, mode: "live", sleep: noSleep });
    expect(r.matches).toHaveLength(1);
    expect(r.raw).toBe(text);
    expect(r.rawSha256).toBe(createHash("sha256").update(text).digest("hex"));
  });
});
