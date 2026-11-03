// The app's agent port asks core's allow() before every model call (W5's leftover): on the demo default
// a sample shop's call is allowed and counted in ai.usage; once the operator's approved change turns the shop's AI off,
// the next call is refused, so the run abstains. Red-proved by hand (the port without allow lets the refused call through).
import { afterAll, beforeAll, expect, it } from "vitest";
import { proposeAndApprove } from "../../../db/test/v2/core/platform/fixture.ts";
import { startRun } from "../lib/server/agent-port";
import { type Home, openHome } from "./helpers/home-db";

let h: Home;
beforeAll(async () => {
  h = await openHome();
});
afterAll(() => h.close());

const usage = async () => Number((await h.db.admin.query("select coalesce(sum(calls), 0) as n from ai.usage where tenant_id = $1", [h.k.tenantId])).rows[0].n);

it("a model call through the app's port is allowed and counted on the demo default, and refused once the shop's AI is off", async () => {
  const run = await startRun(h.k.owner, "question");
  const before = await usage();
  expect(await run.port.allow?.("reason")).toBe(true);
  expect(await usage()).toBe(before + 1);
  await proposeAndApprove(h.db, h.operator, { kind: "shop_config", tenantId: h.k.tenantId, set: { ai_enabled: false } });
  expect(await run.port.allow?.("reason")).toBe(false);
  expect(await usage()).toBe(before + 1);
});
