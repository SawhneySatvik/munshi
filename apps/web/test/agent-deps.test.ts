// A deployed function has no repo tree: live answers must not look for the recorded fixtures, or every AI run dies at
// its first step. Recorded mode still needs them.
import { afterEach, expect, it, vi } from "vitest";
import { agentDeps } from "../lib/server/agent-port";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("live mode needs no repo on disk; recorded mode still finds its fixtures", () => {
  vi.stubEnv("MUNSHI_MODEL_MODE", "live");
  vi.spyOn(process, "cwd").mockReturnValue("/");
  expect(agentDeps("ask")).toEqual({ mode: "live" });
  vi.restoreAllMocks();
  vi.stubEnv("MUNSHI_MODEL_MODE", "recorded");
  expect(agentDeps("ask").fixturesDir).toMatch(/apps\/web\/fixtures\/ask$/);
});
