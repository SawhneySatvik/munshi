// P-5 Settings → AI staff on the demo kirana as `pnpm dev` seeds it (the demo defaults and the edition's model
// allow-list, approved by the operator): one row per agent with the model that answers now; the owner's picker offers
// the allowed aliases and "Default"; a pick is the owner's own audited row under the form's key (a keyless form and a
// replayed key write nothing more); a manager or staff member sees the same rows read-only, and their pick is refused.
import { editionAllowList } from "@munshi/ai";
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { chooseModelAction } from "../app/app/settings/actions";
import type { AiStaffPage } from "../app/app/settings/ai/data";
import AiStaffRoute from "../app/app/settings/ai/page";
import { LangProvider } from "../components/LangProvider";
import { dataOf } from "./app-render";
import { type Home, openHome, rows, signInAs } from "./home-db";
import { formOf } from "./ops-db";
import { fakeMatchMedia } from "./render";

let h: Home;
beforeAll(async () => {
  h = await openHome();
}, 300_000);
afterAll(() => h.close());
beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const choices = () => rows<{ agent: string; alias: string | null; by: string }>(h, "select agent, alias, chosen_by::text as by from ops.model_choice order by chosen_at, id");

test("AISTAFF1 the owner sees every desk with its model and a picker of the allowed aliases, and picks one as their own row", async () => {
  signInAs(h.k.owner);
  const el = await AiStaffRoute();
  const data = dataOf<AiStaffPage>(el);
  expect(data.owner).toBe(true);
  expect(data.rows).toHaveLength(9); // ref.ai_agent's thirteen (speak, documents, shelf_video included), less the four with no agent code yet (AISTAFF3)
  // The meta edition's list offers the other providers too, behind Meta's own (D-077): the picker lists every one, by name.
  const allowedFor = (role: string) => editionAllowList("meta").filter((p) => p.role === role).map((p) => p.alias).sort();
  expect(allowedFor("narrate")).toEqual(expect.arrayContaining(["muse-spark", "spark-open", "gemini-flash"]));
  expect(data.rows.find((r) => r.agent === "brief")).toMatchObject({ current: "spark-open", defaultAlias: "spark-open", allowed: allowedFor("narrate"), chosen: null });
  expect(data.rows.find((r) => r.agent === "ask")).toMatchObject({ current: "muse-spark", allowed: allowedFor("reason") });
  // W2-C: the speak desk is Sarvam's Bulbul, its default on the meta edition too (Meta has no text-to-speech model).
  expect(data.rows.find((r) => r.agent === "speak")).toMatchObject({ current: "bulbul-v3", defaultAlias: "bulbul-v3", allowed: ["bulbul-v3"] });
  render(<LangProvider initial="en">{el}</LangProvider>);
  expect(screen.getByRole("form", { name: "Model for Morning brief" })).toBeTruthy();
  expect(screen.getAllByText(/Model: spark-open/).length).toBeGreaterThan(0);
  cleanup();

  const keyless = formOf({ agent: "brief", alias: "muse-spark" });
  keyless.delete("key");
  expect(await chooseModelAction(null, keyless)).toEqual({ error: "other" });
  const form = formOf({ agent: "brief", alias: "muse-spark" });
  expect(await chooseModelAction(null, form)).toEqual({ done: true });
  expect(await chooseModelAction(null, form)).toEqual({ done: true }); // the same key again: the first row's id, nothing new
  expect(await choices()).toEqual([{ agent: "brief", alias: "muse-spark", by: h.k.owner.memberId }]);
  expect(dataOf<AiStaffPage>(await AiStaffRoute()).rows.find((r) => r.agent === "brief")).toMatchObject({ chosen: "muse-spark", current: "muse-spark" });
  // An alias the platform does not allow for the role is refused, and so is one this build does not serve.
  expect(await chooseModelAction(null, formOf({ agent: "ask", alias: "spark-open" }))).toMatchObject({ error: expect.any(String) });
  expect(await chooseModelAction(null, formOf({ agent: "ask", alias: "gpt-unknown" }))).toMatchObject({ error: expect.any(String) });
  // "Default" records no alias: the desk follows the shop's default, else the edition's.
  expect(await chooseModelAction(null, formOf({ agent: "brief", alias: "default" }))).toEqual({ done: true });
  expect((await choices()).at(-1)).toEqual({ agent: "brief", alias: null, by: h.k.owner.memberId });
  expect(dataOf<AiStaffPage>(await AiStaffRoute()).rows.find((r) => r.agent === "brief")).toMatchObject({ chosen: null, current: "spark-open" });
});

test("AISTAFF2 a manager or staff member sees the desks read-only, and their pick is refused", async () => {
  for (const who of [h.k.manager, h.k.staff[0]]) {
    if (!who) throw new Error("test: the kirana has staff");
    signInAs(who);
    const el = await AiStaffRoute();
    expect(dataOf<AiStaffPage>(el).owner).toBe(false);
    render(<LangProvider initial="en">{el}</LangProvider>);
    expect(screen.queryAllByRole("form")).toEqual([]);
    expect(screen.getByText("The model each desk uses. Only the owner can change them.")).toBeTruthy();
    cleanup();
    const before = (await choices()).length;
    expect(await chooseModelAction(null, formOf({ agent: "brief", alias: "muse-spark" }))).toMatchObject({ error: expect.any(String) });
    expect(await choices()).toHaveLength(before);
  }
});

test("AISTAFF3 the desks with no agent code (counter, settlements) leave the picker; every desk an agent runs stays", async () => {
  signInAs(h.k.owner);
  const el = await AiStaffRoute();
  const agents = dataOf<AiStaffPage>(el).rows.map((r) => r.agent);
  expect(agents).not.toContain("counter");
  expect(agents).not.toContain("settlements");
  expect(agents).toEqual(expect.arrayContaining(["ask", "bills", "shelf", "voice", "brief", "chat_to_order", "campaigns", "replies"]));
  render(<LangProvider initial="en">{el}</LangProvider>);
  expect(screen.queryByRole("form", { name: "Model for Counter helper" })).toBeNull();
  expect(screen.queryByRole("form", { name: "Model for Settlements" })).toBeNull();
  expect(screen.getByRole("form", { name: "Model for Replies" })).toBeTruthy();
});
