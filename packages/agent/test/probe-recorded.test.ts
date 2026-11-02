// Every (alias, role) pair of the paytm edition's other providers replays the call the live probe made for it
// (scripts/model-probe.ts recorded only passing calls, in fixtures/probe/): a role listed for an alias without a passing
// live call has no fixture, and this fails. Gemini's pairs were probed before the probe recorded (docs/model-probe-2026-10-31.md).
import { describe, expect, it } from "vitest";
import { editionAllowList } from "../src/config.ts";
import { aliasBinding, MODEL_ALIASES } from "../src/models.ts";
import { generate } from "../src/providers/generate.ts";
import { transcribe } from "../src/providers/transcribe.ts";
import { HINDI_WAV, PROBE_CALLS, PROBE_FIXTURES, ROLE_CHECKS } from "../scripts/probe-requests.ts";

const recorded = { mode: "recorded", fixturesDir: PROBE_FIXTURES, env: {} } as const;
// Speak (bulbul-v3, W2-C) is not a chat role and was not in the 31 Oct probe: its adapter is held by test/sarvam.test.ts
// on recorded synthetic fixtures, and it stays out of this list until a live probe records it.
const pairs = editionAllowList("paytm").filter((p) => MODEL_ALIASES[p.alias]?.provider !== "gemini" && p.role !== "speak");

describe("PROBE1 every chat and voice pair of the paytm allow-list passed the live probe (bulbul-v3 speak is not yet probed live)", () => {
  it("covers every new provider", () => {
    expect(new Set(pairs.map((p) => MODEL_ALIASES[p.alias]?.provider))).toEqual(new Set(["anthropic", "openai", "openrouter", "nvidia", "sarvam"]));
    expect(pairs.length).toBe(27);
  });

  for (const { alias, role } of pairs) {
    it(`${alias} ${role}`, async () => {
      if (role === "voice") {
        const r = await transcribe({ wav: HINDI_WAV, language: "Hindi" }, { ...recorded, edition: "paytm" });
        expect(r).toMatchObject({ provider: "sarvam", model: MODEL_ALIASES[alias]?.model, language: "hi-IN" });
        expect(r.text.trim()).not.toBe("");
        return;
      }
      const checks = ROLE_CHECKS[role];
      expect(checks, role).toBeDefined();
      for (const c of checks ?? []) {
        const r = await generate(PROBE_CALLS[c], { ...recorded, chain: async () => [aliasBinding(alias, role) as NonNullable<ReturnType<typeof aliasBinding>>] });
        if (c === "tool") expect(r.toolCalls.map((t) => t.name), c).toContain("record_sale");
        else expect(r.json, c).toBeDefined();
      }
    });
  }
});
