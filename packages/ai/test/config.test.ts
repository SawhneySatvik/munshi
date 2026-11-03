import { describe, expect, it } from "vitest";
import { BASE_URLS, DEFAULT_ALIASES, DEFAULT_ROLES, modelCatalogue } from "../src/config.ts";
import { KNOWN_ALIASES } from "../src/models.ts";
import { ROLES } from "../src/providers/types.ts";

describe("model config", () => {
  it("Meta's models are the default for every role but speak, which is Sarvam's Bulbul", () => {
    const m = DEFAULT_ROLES;
    expect(m.router).toEqual({ provider: "meta", model: "muse-spark-1.3" });
    expect(m.reason.model).toBe("muse-spark-1.3");
    expect(m.vision.model).toBe("muse-spark-1.3");
    expect(m.segment).toEqual({ provider: "meta", model: "sam-3.1" });
    expect(m.voice).toEqual({ provider: "meta", model: "muse-voice-transcribe-1.0" });
    expect(m.narrate).toEqual({ provider: "baseten", model: "meta-models/muse-spark-open-1026" });
    expect(m.speak).toEqual({ provider: "sarvam", model: "bulbul:v3" });
  });

  it("every role has a default, and core is handed exactly those with the aliases this build serves", () => {
    expect(Object.keys(DEFAULT_ROLES).sort()).toEqual([...ROLES].sort());
    expect(modelCatalogue()).toEqual({ known: KNOWN_ALIASES, defaults: DEFAULT_ALIASES });
  });

  it("base URLs", () => {
    expect(BASE_URLS.meta).toBe("https://api.meta.ai/v1");
    expect(BASE_URLS.baseten).toBe("https://inference.baseten.co/v1");
    expect(BASE_URLS.openrouter).toBe("https://openrouter.ai/api/v1");
  });
});
