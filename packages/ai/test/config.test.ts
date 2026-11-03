import { describe, expect, it } from "vitest";
import { BASE_URLS, EDITION_ROLES, parseEdition, resolveRoles } from "../src/config.ts";
import { ROLES } from "../src/providers/types.ts";

describe("edition config", () => {
  it("meta edition maps every role as specified", () => {
    const m = resolveRoles("meta");
    expect(m.router).toEqual({ provider: "meta", model: "muse-spark-1.3" });
    expect(m.reason.model).toBe("muse-spark-1.3");
    expect(m.vision.model).toBe("muse-spark-1.3");
    expect(m.segment).toEqual({ provider: "meta", model: "sam-3.1" });
    expect(m.voice).toEqual({ provider: "meta", model: "muse-voice-transcribe-1.0" });
    expect(m.narrate).toEqual({ provider: "baseten", model: "meta-models/muse-spark-open-1026" });
  });

  it("every edition covers all six roles", () => {
    for (const e of Object.keys(EDITION_ROLES) as (keyof typeof EDITION_ROLES)[]) {
      expect(Object.keys(resolveRoles(e)).sort()).toEqual([...ROLES].sort());
    }
  });

  it("a role missing from an edition fails", () => {
    const { voice: _v, ...partial } = EDITION_ROLES.meta;
    expect(() => resolveRoles("meta", partial)).toThrow(/role "voice" is not mapped/);
  });

  it("unknown provider, unknown role and unknown edition fail", () => {
    expect(() => resolveRoles("meta", { ...EDITION_ROLES.meta, narrate: { provider: "acme" as never, model: "x" } })).toThrow(/unknown provider "acme"/);
    expect(() => resolveRoles("meta", { ...EDITION_ROLES.meta, dream: { provider: "meta", model: "x" } })).toThrow(/unknown role "dream"/);
    expect(() => parseEdition("nope")).toThrow(/unknown edition/);
  });

  it("base URLs", () => {
    expect(BASE_URLS.meta).toBe("https://api.meta.ai/v1");
    expect(BASE_URLS.baseten).toBe("https://inference.baseten.co/v1");
    expect(BASE_URLS.openrouter).toBe("https://openrouter.ai/api/v1");
  });
});
