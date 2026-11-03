// Every (alias, role) pair of the fallback providers past Meta and Gemini replays the call the live probe made for it
// (scripts/model-probe.ts recorded only passing calls, in fixtures/probe/): a role listed for an alias without a passing
// live call has no fixture, and this fails. Gemini's and Meta's pairs were probed before the probe recorded.
import { describe, expect, it } from "vitest";
import { allowList } from "../src/config.ts";
import { aliasBinding, MODEL_ALIASES } from "../src/models.ts";
import { generate } from "../src/providers/generate.ts";
import { transcribe } from "../src/providers/transcribe.ts";
import { HINDI_WAV, PROBE_CALLS, PROBE_FIXTURES, ROLE_CHECKS } from "../scripts/probe-requests.ts";

const recorded = { mode: "recorded", fixturesDir: PROBE_FIXTURES, env: {} } as const;
// Speak (bulbul-v3) is not a chat role and was not in the 31 Oct probe: its adapter is held by test/sarvam.test.ts
// on recorded synthetic fixtures, and it stays out of this list until a live probe records it.
const PROBED = new Set(["anthropic", "openai", "openrouter", "nvidia", "sarvam"]);
const pairs = allowList().filter((p) => PROBED.has(MODEL_ALIASES[p.alias]?.provider as string) && p.role !== "speak");

describe("every chat and voice pair of the fallback providers passed the live probe (bulbul-v3 speak is not yet probed live)", () => {
  it("covers every fallback provider", () => {
    expect(new Set(pairs.map((p) => MODEL_ALIASES[p.alias]?.provider))).toEqual(PROBED);
    expect(pairs.length).toBe(27);
  });

  for (const { alias, role } of pairs) {
    it(`${alias} ${role}`, async () => {
      if (role === "voice") {
        const r = await transcribe({ wav: HINDI_WAV, language: "Hindi" }, { ...recorded, permitted: async () => [alias] });
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
