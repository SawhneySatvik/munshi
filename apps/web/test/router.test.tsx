// The superadmin's router per shop and AI spend, on the demo kirana as `pnpm dev` seeds it, through the
// app's own agent port (startRun, its deps, briefNarrator) and core over the real database; only the models are a fake
// transport at the system boundary. A model off the shop's list is never called (a run's chain, and a call with no
// chain); narration off leaves the brief's template with no model call, no spend and no second try; memory off lets
// the decision stand and keeps no note, the card saying notes are off; a feature switched off is labelled and its
// direct action refused with feature_off. Every model call writes one spend row (a replay none); the hard cap refuses
// before the model is called; the soft cap shows the banner; spend figures render only from cells; no price is
// "Cannot verify", never zero. That a change takes effect only once approved is console-router.test.tsx's.
// Red-proofs: db/test/v2/sabotage/router.ts.
import { aliasOf, costOf, generate, modelCatalogue, segment, speak } from "@munshi/ai";
import { narrateBrief } from "@munshi/agent";
import { aiStaff, allow, chooseModel, decide, recordSpend, shopModelList, withTx, writeBrief } from "@munshi/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { proposeAndApprove } from "../../../db/test/v2/core/platform/fixture.ts";
import { env, json, noSleep, queueFetch, responsesBody, tmpFixtures, wavBytes } from "../../../packages/agent/test/helpers.ts";
import { askAction } from "../app/app/ask/actions";
import type { AiStaffPage } from "../app/app/settings/ai/data";
import AiStaffRoute from "../app/app/settings/ai/page";
import { AiFeaturesProvider } from "../components/AiFeatures";
import { AskProvider } from "../components/AskProvider";
import { AskView } from "../components/AskView";
import { LangProvider } from "../components/LangProvider";
import { MicButton } from "../components/MicButton";
import { NoteField } from "../components/NoteField";
import { briefNarrator, endRun, featuresSwitchedOff, inRun, startRun } from "../lib/server/agent-port";
import { loadHome } from "../lib/server/home";
import { formatMoney } from "../lib/snapshot";
import { dataOf } from "./helpers/app-render";
import { AS_OF, type Home, openHome, rows, signInAs } from "./helpers/home-db";
import { formOf } from "./helpers/ops-db";
import { fakeMatchMedia, renderHome, unsourced } from "./helpers/render";

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

const change = (kind: "shop_features" | "shop_models" | "ai_budget", set: Record<string, unknown>) =>
  proposeAndApprove(h.db, h.operator, { kind, tenantId: h.k.tenantId, set });
const feature = (name: string, enabled: boolean) => change("shop_features", { feature: name, enabled });
const shopModel = (alias: string, role: string, allowed = true, isDefault = false) => change("shop_models", { alias, role, allowed, is_default: isDefault });
const budget = (minor: number | null) => change("ai_budget", minor === null ? { monthly_minor: null, currency: null } : { monthly_minor: minor, currency: "USD" });

const spendOf = (runId: string) =>
  rows<{ role: string; alias: string; tokens_in: number; tokens_out: number; cost: string | null; currency: string | null }>(
    h,
    "select role, alias, tokens_in, tokens_out, cost_minor_e6::text as cost, currency from ai.spend where run_id = $1 order by at, id",
    [runId],
  );
const count = async (sql: string, params: unknown[] = []) => (await rows<{ n: number }>(h, `select count(*)::int as n from (${sql}) x`, params))[0]?.n;
const openFinding = async () => (await rows<{ id: string }>(h, "select id::text from ai.finding where status = 'open' order by id limit 1"))[0]?.id as string;
const host = (call: { url: string } | undefined) => new URL(call?.url ?? "http://none").host;

// The fake models: a chat completion (Baseten, Gemini) and a Responses answer (Meta), each reporting its usage.
const chat = (content: string) =>
  json(200, {
    id: "c",
    object: "chat.completion",
    created: 0,
    model: "m",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  });
const metaSays = (text: string) =>
  json(200, responsesBody({ output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }] }));
const live = (fetch: typeof globalThis.fetch) => ({ env: { ...env, GEMINI_API_KEY: "g-test-SECRET-0123456789" }, fetch, mode: "live", sleep: noSleep });
const NO_SEGMENTS = '{"segments":[]}';

test("a model off the shop's list is never called: a run's chain holds only the shop's aliases, a call with no chain is moved onto the list, and a role whose list allows nothing calls no model", async () => {
  vi.stubGlobal("navigator", undefined); // the OpenAI SDK takes jsdom for a browser and builds no client where it sees one
  // The shop's own narrate list: Muse Spark Open, its default; Muse Spark not allowed (the deployment enables both).
  await shopModel("spark-open", "narrate", true, true);
  await shopModel("muse-spark", "narrate", false);
  const run = await startRun(h.k.owner, "question");
  expect(await run.port.models?.("brief", "narrate")).toEqual(["spark-open"]);
  const finding = await openFinding();
  const told = queueFetch(chat(NO_SEGMENTS));
  await inRun(run, () => narrateBrief([finding], { port: run.port, asOf: AS_OF, deps: run.deps(live(told.f), "brief") }));
  expect(told.calls.map(host)).toEqual(["inference.baseten.co"]);

  // A call with no chain (a photo's vision call): the default Muse Spark is off the shop's vision list, so the list's
  // own alias answers instead.
  await shopModel("gemini-flash", "vision", true);
  const photo = await startRun(h.k.owner, "photo", "shelf");
  const looked = queueFetch(chat("a shelf"));
  const r = await generate({ role: "vision", messages: [{ role: "user", content: "What is on the shelf?" }] }, photo.deps(live(looked.f), "shelf"));
  expect(r.provider).toBe("gemini");
  expect(looked.calls.map(host)).toEqual(["generativelanguage.googleapis.com"]);
  // A role whose own list allows nothing: refused before any call.
  await shopModel("sam", "segment", false);
  // Its list still governs the role though nothing on it is allowed (not the deployment's, which would offer sam).
  expect(await withTx(h.db.app, { kind: "system", tenantId: h.k.tenantId }, (c) => shopModelList(c, "segment"))).toEqual({ aliases: [], shopDefault: null, source: "shop" });
  const none = queueFetch();
  await expect(segment({ imageUrl: "data:image/png;base64,AAAA", prompt: { phrase: "packet" } }, photo.deps(live(none.f), "shelf"))).rejects.toThrow(/shop's list/);
  expect(none.calls).toHaveLength(0);
  await endRun(photo);
});

test("every model call writes one spend row, as the run's member, before the run ends; a recorded replay writes none", async () => {
  vi.stubGlobal("navigator", undefined); // the OpenAI SDK takes jsdom for a browser and builds no client where it sees one
  const run = await startRun(h.k.owner, "question");
  // A chain call (the brief's narrate, Muse Spark Open, unpriced): one row with the adapter's tokens and no cost.
  const finding = await openFinding();
  const narrated = queueFetch(chat(NO_SEGMENTS));
  await narrateBrief([finding], { port: run.port, asOf: AS_OF, deps: run.deps(live(narrated.f), "brief") });
  expect(narrated.calls.map(host)).toEqual(["inference.baseten.co"]);
  expect(await spendOf(run.runId)).toEqual([{ role: "narrate", alias: "spark-open", tokens_in: 11, tokens_out: 7, cost: null, currency: null }]);

  // A priced alias in record mode (a real call, its answer kept): one row, its cost from the price table; replayed, none.
  await shopModel("muse-spark", "vision", true, true);
  const dir = tmpFixtures();
  const asked = { role: "vision" as const, messages: [{ role: "user" as const, content: "Count the packets." }] };
  const once = queueFetch(metaSays("twelve"));
  await generate(asked, run.deps({ ...live(once.f), mode: "record", fixturesDir: dir }, "shelf"));
  await generate(asked, run.deps({ ...live(queueFetch().f), mode: "recorded", fixturesDir: dir }, "shelf"));
  expect(once.calls.map(host)).toEqual(["api.meta.ai"]);
  const cost = costOf("muse-spark", { inputTokens: 11, outputTokens: 7 });
  expect(cost).toEqual({ costMinorE6: Math.ceil((11 * 1_250_000 + 7 * 4_250_000) / 10_000), currency: "USD" });

  // A call with no token usage of its own kind: a speak request, counted by the characters it voiced.
  const voiced = queueFetch(json(200, { audios: ["SUQzBA=="] }));
  const words = "Read this aloud.";
  await speak({ text: words, language: "en-IN" }, run.deps({ ...live(voiced.f), env: { ...env, SARVAM_API_KEY: "sv-test-SECRET-0123456789" } }, "speak"));
  expect(voiced.calls.map(host)).toEqual(["api.sarvam.ai"]);
  expect(await spendOf(run.runId)).toEqual([
    { role: "narrate", alias: "spark-open", tokens_in: 11, tokens_out: 7, cost: null, currency: null },
    { role: "vision", alias: "muse-spark", tokens_in: 11, tokens_out: 7, cost: String(cost?.costMinorE6), currency: "USD" },
    { role: "speak", alias: "bulbul-v3", tokens_in: words.length, tokens_out: 0, cost: null, currency: null },
  ]);
  await endRun(run);
  // Once the run has ended, no spend is written against it.
  await expect(recordSpend(h.db.app, { kind: "member", session: h.k.owner }, { runId: run.runId, role: "vision", alias: "muse-spark", tokensIn: 1, tokensOut: 1, cost: null })).rejects.toThrow();
});

test("narration off: the brief keeps its template lines with no model call, no spend and no second try", async () => {
  await feature("narration", false);
  const q = queueFetch(); // any call would fail the narrator, and the brief's run would say so
  const narrate = briefNarrator(h.db.jobs, live(q.f));
  const b = await writeBrief(h.db.jobs, h.k.tenantId, h.k.shopId, { asOf: AS_OF, narrate });
  expect(b?.answerId).toBeNull();
  expect(q.calls).toHaveLength(0);
  expect(await rows(h, "select outcome, model_calls from ai.run where id = $1", [b?.runId])).toEqual([{ outcome: "off", model_calls: 0 }]);
  expect(await spendOf(b?.runId as string)).toEqual([]);
  expect(await count("select 1 from ai.trace where run_id = $1 and kind = 'model'", [b?.runId])).toBe(0);
  // The day's brief stands: the next tick writes nothing and calls nothing.
  expect(await writeBrief(h.db.jobs, h.k.tenantId, h.k.shopId, { asOf: AS_OF, narrate })).toBeNull();
  expect(q.calls).toHaveLength(0);
  await feature("narration", true);
});

test("memory off: the decision stands and no note is kept; the card says notes are off", async () => {
  await feature("memory", false);
  const d = await decide(h.db.app, h.k.owner, h.draftId, "rejected", "not_now", "Not this week, the shelf is full");
  expect(d).toMatchObject({ status: "rejected", notesOff: true });
  expect(await count("select 1 from approval.decision where draft_id = $1 and verdict = 'rejected'", [h.draftId])).toBe(1);
  expect(await count("select 1 from ai.memory m join approval.decision d on d.id = m.decision_id where d.draft_id = $1", [h.draftId])).toBe(0);
  render(
    <LangProvider initial="en">
      <AiFeaturesProvider off={await featuresSwitchedOff(h.k.owner)}>
        <NoteField id="d1" />
      </AiFeaturesProvider>
    </LangProvider>,
  );
  expect(screen.getByText(/Notes are off for this shop/)).toBeTruthy();
  expect(document.querySelector("textarea[name=note]")).toBeNull();
  await feature("memory", true);
});

test("a feature switched off is labelled where it would be, and its direct action is refused with feature_off before any run", async () => {
  await feature("ask", false);
  expect(await featuresSwitchedOff(h.k.owner)).toEqual(["ask"]);
  const runs = await count("select 1 from ai.run");
  await expect(startRun(h.k.owner, "question")).rejects.toMatchObject({ code: "feature_off" });
  signInAs(h.k.owner);
  expect(await askAction(null, formOf({ question: "Who owes me money?" }))).toEqual({ error: "off" });
  expect(await count("select 1 from ai.run")).toBe(runs);
  render(
    <LangProvider initial="en">
      <AiFeaturesProvider off={["ask"]}>
        <AskProvider who={h.k.owner.memberId}>
          <AskView data={{ shop: "Sharma General Store", member: { name: "Rajesh Sharma", role: "owner" }, recorded: true, questions: [] }} />
          <ul>
            <MicButton />
          </ul>
        </AskProvider>
      </AiFeaturesProvider>
    </LangProvider>,
  );
  expect(document.querySelector('[data-switched-off="ask"]')?.textContent).toBe("Switched off for this shop.");
  expect(document.querySelector("form.composer")?.closest("[hidden]")).toBeTruthy();
  expect(document.querySelector(".nav-mic")).toBeNull();
  await feature("ask", true);
  expect(await featuresSwitchedOff(h.k.owner)).toEqual([]);
});

// This month's priced spend (USD), seeding ten cents in a run of the owner's when there is less, so each SP test stands
// alone: the budgets below are set against it.
async function pricedSpend(): Promise<number> {
  const sum = async () => Number((await rows<{ s: string }>(h, "select coalesce(sum(cost_minor_e6), 0)::text as s from ai.spend where currency = 'USD'"))[0]?.s);
  if ((await sum()) < 10_000_000) {
    const run = await startRun(h.k.owner, "question");
    await recordSpend(h.db.app, { kind: "member", session: h.k.owner }, { runId: run.runId, role: "reason", alias: "muse-spark", tokensIn: 0, tokensOut: 0, cost: { costMinorE6: 10_000_000, currency: "USD" } });
    await endRun(run);
  }
  return sum();
}
// A budget, in whole cents, that the priced spend has reached (hard), or is past 80% of without reaching (soft).
const hardBudget = (spent: number) => Math.floor(spent / 1_000_000);
const softBudget = (spent: number) => {
  const b = Math.floor(spent / 1_000_000) + 1;
  expect(spent < b * 1_000_000 && spent * 5 >= b * 4_000_000).toBe(true);
  return b;
};

test("the hard cap refuses a call before the model is called, and counts nothing", async () => {
  await budget(hardBudget(await pricedSpend()));
  const usage = () => count("select 1 from ai.usage u, generate_series(1, u.calls)");
  const before = await usage();
  expect(await allow(h.db.app, h.k.tenantId, "reason", "on")).toEqual({ ok: false, reason: "budget" });
  expect(await usage()).toBe(before);
  const run = await startRun(h.k.owner, "question");
  const q = queueFetch();
  const finding = await openFinding();
  const reply = await inRun(run, () => narrateBrief([finding], { port: run.port, asOf: AS_OF, deps: run.deps(live(q.f), "brief") }));
  expect(reply.kind).toBe("abstain");
  expect(q.calls).toHaveLength(0);
  expect(await spendOf(run.runId)).toEqual([]);
  signInAs(h.k.owner);
  render(<LangProvider initial="en">{await AiStaffRoute()}</LangProvider>);
  expect(document.querySelector('[data-spend-state="hard"]')).toBeTruthy();
});

test("the soft cap shows the owner the banner, and calls go on", async () => {
  await budget(softBudget(await pricedSpend()));
  expect(await allow(h.db.app, h.k.tenantId, "reason", "on")).toEqual({ ok: true });
  signInAs(h.k.owner);
  const el = await AiStaffRoute();
  expect(dataOf<AiStaffPage>(el).spend?.state).toBe("soft");
  render(<LangProvider initial="en">{el}</LangProvider>);
  expect(document.querySelector('[data-spend-state="soft"]')?.textContent).toMatch(/Most of this month's AI budget is spent/);
  cleanup();
  // Home too, for the owner and a manager (the state is a minted cell; the words carry no figure); not for counter staff.
  for (const who of [h.k.owner, h.k.manager]) {
    const home = await loadHome(who);
    expect(home.spendState).toBe("soft");
    renderHome(home);
    const banner = document.querySelector('[data-spend-state="soft"]');
    expect(banner?.textContent).toMatch(/Most of this month's AI budget is spent/);
    expect(banner?.textContent).not.toMatch(/\d/);
    cleanup();
  }
  expect((await loadHome(h.k.staff[0] as typeof h.k.owner)).spendState).toBeUndefined();
});

test("spend figures render only from stored cells: every digit in the spend section is a chip to its row", async () => {
  const b = softBudget(await pricedSpend());
  await budget(b);
  signInAs(h.k.owner);
  const el = await AiStaffRoute();
  const data = dataOf<AiStaffPage>(el);
  const ids = new Set(data.snapshots.map((s) => s.id));
  const spend = data.spend;
  if (!spend) throw new Error("test: the owner sees spend");
  for (const ref of [spend.budget, spend.spent, spend.calls, spend.unpriced, ...spend.desks.flatMap((d) => [d.calls, d.cost])]) if (ref) expect(ids.has(ref.snapshotId)).toBe(true);
  render(<LangProvider initial="en">{el}</LangProvider>);
  const section = screen.getByRole("region", { name: "AI spend this month" });
  expect(within(section).getAllByRole("button").length).toBeGreaterThan(3);
  expect(unsourced(section)).toEqual([]);
  // The budget's chip is the budget's own cell (the spend, rounded up to the cent, may read the same).
  expect(within(section).getAllByText(formatMoney(b, "USD", "short")).length).toBeGreaterThan(0);
});

test("no price is \"Cannot verify\", never zero: an unpriced alias's cost is null, stored and shown so", async () => {
  expect(costOf("spark-open", { inputTokens: 11, outputTokens: 7 })).toBeNull();
  expect(costOf("muse-spark", null)).toBeNull();
  // A call of an alias with no price, and a budget, so the month's total shows.
  const run = await startRun(h.k.owner, "question");
  await recordSpend(h.db.app, { kind: "member", session: h.k.owner }, { runId: run.runId, role: "narrate", alias: "spark-open", tokensIn: 11, tokensOut: 7, cost: null });
  await endRun(run);
  await budget(100000);
  signInAs(h.k.owner);
  const el = await AiStaffRoute();
  const spend = dataOf<AiStaffPage>(el).spend;
  expect(spend?.desks.find((d) => d.alias === "spark-open")?.cost).toBeNull();
  expect(spend?.partial).toBe(true);
  render(<LangProvider initial="en">{el}</LangProvider>);
  const section = screen.getByRole("region", { name: "AI spend this month" });
  const byDesk = section.querySelector('[data-slot="spend-by-desk"]') as HTMLElement;
  const line = [...byDesk.querySelectorAll("div")].find((d) => d.textContent?.includes("spark-open")) as HTMLElement;
  expect(line.textContent).toMatch(/Cannot verify/);
  expect(line.textContent).not.toMatch(/0\.00/);
  // The month's total leaves the unpriced calls out, so it says so beside the figure.
  expect(section.querySelector('[data-slot="spent"]')?.textContent).toMatch(/Cannot verify/);
  await budget(null);
});

test("a call with no chain takes the run's chain in AI staff's order, so the model AI staff names is the model called", async () => {
  vi.stubGlobal("navigator", undefined); // the OpenAI SDK takes jsdom for a browser and builds no client where it sees one
  const cat = modelCatalogue();
  const current = async () => (await withTx(h.db.app, { kind: "system", tenantId: h.k.tenantId }, (c) => aiStaff(c, cat))).find((r) => r.agent === "bills")?.current;
  const look = async () => {
    const run = await startRun(h.k.owner, "photo", "bills");
    // Each provider answers in its own wire format, whichever the call goes to.
    const calls: string[] = [];
    const f = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      return url.includes("api.meta.ai") ? metaSays("a bill") : chat("a bill");
    }) as typeof fetch;
    const r = await generate({ role: "vision", messages: [{ role: "user", content: "Read the bill." }] }, run.deps(live(f), "bills"));
    await endRun(run);
    expect(calls).toHaveLength(1);
    return { alias: aliasOf(r, "vision"), host: host({ url: calls[0] as string }) };
  };
  // Before any pick the bill reader's chain starts with the build's (or the shop's) default, and that is what is called.
  const before = await current();
  expect((await look()).alias).toBe(before);
  // The owner picks Gemini Flash for the bill reader: AI staff names it, and the chainless vision call uses it.
  await chooseModel(h.db.app, h.k.owner, { agent: "bills", alias: "gemini-flash" }, cat);
  expect(await current()).toBe("gemini-flash");
  expect(await look()).toEqual({ alias: "gemini-flash", host: "generativelanguage.googleapis.com" });
});

test("the owner's pick of an alias off the shop's list is refused by core, field alias, and writes nothing", async () => {
  await shopModel("spark-open", "narrate", true, true);
  await shopModel("muse-spark", "narrate", false);
  const picks = () => count("select 1 from ops.model_choice");
  const before = await picks();
  await expect(chooseModel(h.db.app, h.k.owner, { agent: "brief", alias: "muse-spark" }, modelCatalogue())).rejects.toMatchObject({ code: "refused", fields: ["alias"] });
  expect(await picks()).toBe(before);
  // On the list, the same owner's pick goes through.
  await chooseModel(h.db.app, h.k.owner, { agent: "brief", alias: "spark-open" }, modelCatalogue());
  expect(await picks()).toBe((before ?? 0) + 1);
});

test("voice switched off: a spoken question is refused as off before any run, and the mic is gone", async () => {
  await feature("voice", false);
  signInAs(h.k.owner);
  const runs = await count("select 1 from ai.run");
  const form = new FormData();
  form.set("audio", new Blob([wavBytes()], { type: "audio/wav" }), "q.wav");
  expect(await askAction(null, form)).toEqual({ error: "off" });
  expect(await count("select 1 from ai.run")).toBe(runs);
  render(
    <LangProvider initial="en">
      <AiFeaturesProvider off={await featuresSwitchedOff(h.k.owner)}>
        <AskProvider who={h.k.owner.memberId}>
          <ul>
            <MicButton />
          </ul>
        </AskProvider>
      </AiFeaturesProvider>
    </LangProvider>,
  );
  expect(document.querySelector(".nav-mic")).toBeNull();
  await feature("voice", true);
});
