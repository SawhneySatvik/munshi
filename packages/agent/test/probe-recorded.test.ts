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
const pairs = editionAllowList("paytm").filter((p) => MODEL_ALIASES[p.alias]?.provider !== "gemini");

describe("PROBE1 the paytm allow-list holds only pairs that passed the live probe", () => {
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
