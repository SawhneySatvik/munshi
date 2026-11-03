// A recorded demo on any day. The demo kirana is seeded as of 27 Oct 2026, the day the recorded model answers were
// asked on; the app's clock reads a later day. The jobs tick, as the app runs it, must keep the sample shop on its
// seeded day (core's holdSampleDay, while answers are replayed): then Ask replays the recorded answer and cites cells read
// as of that day, Reports read the seeded days, and Home, Reports and Ask each say which day it is. Signed in, <html>
// names the shop's data class and slug for the capture guard. Red-proofs: db/test/v2/sabotage/demo-clock.ts.
import { businessDate } from "@munshi/core";
import { cleanup, render } from "@testing-library/react";
import type pg from "pg";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { POST as tick } from "../app/api/internal/tick/route";
import RootLayout from "../app/layout";
import { askAction } from "../app/app/ask/actions";
import AskPage from "../app/app/ask/page";
import { AskProvider } from "../components/AskProvider";
import { ReportView } from "../components/books/ReportView";
import { LangProvider } from "../components/LangProvider";
import type { AskTurn } from "../lib/hero-types";
import { RECORDED_QUESTIONS } from "../lib/i18n-hero";
import { loadReport } from "../lib/server/reports";
import { currentSession } from "../lib/server/session";
import type { Lang } from "../lib/types";
import { state } from "./helpers/app-state";
import { AS_OF, type Home, homeFor, openHome, rows, signInAs, urlAs } from "./helpers/home-db";
import { formOf } from "./helpers/ops-db";
import { fakeMatchMedia, renderHome } from "./helpers/render";

// The root layout's faces are compiled by Next's build; here each loader is a stand-in with no class.
vi.mock("next/font/google", () => {
  const face = () => ({ className: "", style: {} });
  return { Literata: face, Noto_Serif_Devanagari: face, IBM_Plex_Mono: face, Noto_Sans_Devanagari: face };
});

const CREDIT = RECORDED_QUESTIONS[2] as string;
const SECRET = "demo-clock-tick-secret";
// A later day than the seed's, past the brief's morning hour in the shop's zone: noon IST on 15 Dec 2026.
const LATER = new Date("2026-12-15T06:30:00Z");

let h: Home;
beforeAll(async () => {
  h = await openHome();
});
afterAll(async () => {
  const held = globalThis as { munshiJobsPool?: { pool: pg.Pool } };
  await held.munshiJobsPool?.pool.end();
  held.munshiJobsPool = undefined;
  state.tick = undefined;
  await h.close();
});
beforeEach(() => {
  vi.stubGlobal("matchMedia", fakeMatchMedia(false));
  signInAs(h.k.owner);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The jobs tick as the cron sends it, with the server's clock at `at` (only Date is faked; the database keeps time). */
async function tickAt(at: Date): Promise<{ jobs: unknown[]; backOffice: { kind: string; outcome: string }[] }> {
  state.tick = { cronSecret: SECRET, jobsDatabaseUrl: urlAs(h.db, "munshi_jobs") };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
  try {
    const res = await tick(new Request("http://localhost/api/internal/tick", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
    expect(res.status).toBe(200);
    return res.json();
  } finally {
    vi.useRealTimers();
  }
}

const label = (lang: Lang) => (lang === "en" ? "Recorded demo · business day 27 Oct" : "रिकॉर्डेड डेमो · कारोबार का दिन 27 अक्टूबर");

test("on a later day the tick keeps the demo shop on its seeded day: Ask replays the recorded answer, cited as of that day", async () => {
  // The server's own clock is past the seed's day too (the ask below runs on it).
  expect(businessDate(new Date())).not.toBe(AS_OF);
  const ticked = await tickAt(LATER);
  const r = await askAction(null, formOf({ question: CREDIT }));
  const turn = (r as { turn: AskTurn }).turn;
  expect(turn.recorded).toBe(true);
  expect(turn.reply.kind).toBe("answer");
  if (turn.reply.kind !== "answer") return;
  expect(turn.reply.segments[0]?.[0]).toEqual({ t: "name", v: "Ramesh K." });
  expect(turn.reply.segments.flat().filter((p) => p.t === "ref").length).toBeGreaterThan(0);
  // The watchers and the brief both ran, as of the seeded day.
  expect(ticked.backOffice.filter((r) => r.outcome === "ok").map((r) => r.kind)).toEqual(expect.arrayContaining(["brief", "watchers"]));
  const [latest] = await rows<{ as_of: string }>(
    h,
    `select s.params->>'as_of' as as_of from ai.run r join snap.snapshot s on s.tenant_id = r.tenant_id and s.run_id = r.id
      where r.trigger = 'watcher' and r.ended_at is not null order by r.started_at desc limit 1`,
  );
  expect(latest?.as_of).toBe(AS_OF);
  const briefs = await rows<{ day: string }>(h, "select business_date::text as day from ai.brief");
  expect(briefs.map((b) => b.day)).toEqual([AS_OF]);
  // Every cell the answer cites was read as of the day the screen names.
  const read = await rows<{ as_of: string | null }>(h, "select params->>'as_of' as as_of from snap.snapshot where run_id = $1", [turn.id]);
  expect(read.length).toBeGreaterThan(0);
  expect(read.map((s) => s.as_of)).toEqual(read.map(() => AS_OF));
});

test("Reports read the seeded days, and Home, Reports and Ask name the demo's business day in both languages", async () => {
  await tickAt(LATER);
  const session = await currentSession();
  if (!session) throw new Error("test: signed out");
  const report = await loadReport(session, "yesterday");
  if (!report) throw new Error("test: no report");
  expect([report.from, report.to, report.demoDay]).toEqual(["2026-10-26", "2026-10-26", AS_OF]);
  expect(report.days).toHaveLength(1);
  const [sold] = await rows<{ n: number }>(
    h,
    "select count(*)::int as n from books.sale where (sold_at at time zone 'Asia/Kolkata')::date = '2026-10-26' and reverses_id is null",
  );
  expect(sold?.n).toBeGreaterThan(0);

  const home = await homeFor(session);
  expect(home.demoDay).toBe(AS_OF);
  const ask = await AskPage();
  for (const lang of ["en", "hi"] as const) {
    renderHome(home, lang);
    expect(document.querySelector(".page-where [data-demo-day]")?.textContent).toBe(label(lang));
    expect(document.querySelector(".page-where")?.textContent).toMatch(lang === "en" ? /^Brief · / : /^ताज़ा हाल · /);
    cleanup();
    render(
      <LangProvider initial={lang}>
        <ReportView data={report} />
      </LangProvider>,
    );
    expect(document.querySelector("[data-demo-day]")?.textContent).toBe(label(lang));
    cleanup();
    render(
      <LangProvider initial={lang}>
        <AskProvider who={h.k.owner.memberId}>{ask}</AskProvider>
      </LangProvider>,
    );
    expect(document.querySelector("[data-demo-day]")?.textContent).toBe(label(lang));
    cleanup();
  }
});

test("signed in, <html> names the shop's data class and a sample shop's slug; signed out, neither", async () => {
  const html = renderToString(await RootLayout({ children: <main>page</main> }));
  const open = /<html\b[^>]*>/.exec(html)?.[0] ?? "";
  expect(open).toContain('data-class="synthetic"');
  expect(open).toContain('data-tenant="sharma-general-store"');
  state.cookies.clear();
  const out = /<html\b[^>]*>/.exec(renderToString(await RootLayout({ children: <main>page</main> })))?.[0] ?? "";
  expect(out).not.toContain("data-class");
  expect(out).not.toContain("data-tenant");
});
