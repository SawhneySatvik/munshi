// The probe's calls, shared with test/probe-recorded.test.ts (which replays what the probe recorded). Each role passes
// on the call shape its own code paths make: router and narrate ask for a JSON schema, reason both calls a tool (Ask's
// desks) and answers in a schema (copy, inbox, order drafts), vision reads an image into a schema, voice transcribes.
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { GenerateRequest, Role } from "../src/providers/types.ts";

export const PROBE_FIXTURES = new URL("../fixtures/probe/", import.meta.url).pathname;
export const SHELF_PNG = `data:image/png;base64,${readFileSync(new URL("../fixtures/smoke/shelf.png", import.meta.url)).toString("base64")}`;
export const HINDI_WAV = new Uint8Array(readFileSync(new URL("../fixtures/smoke/hindi.wav", import.meta.url)));

const Sale = z.object({ item: z.string(), qty: z.number() });
const Seen = z.object({ things: z.array(z.string()) });

export type Check = "json" | "tool" | "image";
export const PROBE_CALLS: Record<Check, GenerateRequest> = {
  json: { role: "narrate", messages: [{ role: "user", content: "Give the item and quantity as JSON: 3 packets of tea." }], schema: { name: "sale", zod: Sale } },
  tool: {
    role: "reason",
    messages: [{ role: "user", content: "A kirana sold 3 packets of tea. Record it by calling the record_sale tool." }],
    tools: [{ name: "record_sale", description: "Record a sale", parameters: { type: "object", properties: { item: { type: "string" }, qty: { type: "integer" } }, required: ["item", "qty"] } }],
  },
  image: { role: "vision", messages: [{ role: "user", content: "List what you see in this photo, in a few words each.", imageUrl: SHELF_PNG }], schema: { name: "seen", zod: Seen } },
};

/** The checks a text role needs to pass. */
export const ROLE_CHECKS: Partial<Record<Role, Check[]>> = { router: ["json"], narrate: ["json"], reason: ["tool", "json"], vision: ["image"] };
