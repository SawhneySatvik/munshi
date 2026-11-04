// A run is started only once everything it needs is in hand: a question that cannot begin leaves no run behind it, so the
// office's run log never holds one "Still running" for good.
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { askBooks } from "../lib/server/hero";
import { type Home, openHome, rows } from "./helpers/home-db";

vi.mock("../lib/server/agent-port", async (original) => ({
  ...(await original<typeof import("../lib/server/agent-port")>()),
  agentDeps: () => {
    throw new Error("no deps");
  },
}));

let h: Home;
beforeAll(async () => {
  h = await openHome();
});
afterAll(() => h.close());

test("a question whose model setup fails leaves no open run", async () => {
  await expect(askBooks(h.k.owner, { via: "text", question: "How much did the counter sell yesterday?" })).rejects.toThrow("no deps");
  expect(await rows(h, "select id from ai.run where ended_at is null")).toEqual([]);
});
