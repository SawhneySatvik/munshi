// The schedule's Bryntum board, with Bryntum's React wrapper stubbed (it needs a real browser) and the calendar's server
// actions stubbed (schedule.test.tsx runs them on the database): exactly one file imports Bryntum, a client file
// reached only through next/dynamic with SSR off, so no server render loads it; the board edits nothing (every
// editing feature off, a drop always undone in Bryntum's store); and a drop on the page is only a proposal, checked
// by a read, shown beside the original, and sent to the move action only when the person confirms it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { sabotageIs } from "../../../db/test/v2/sabotage/index.ts";
import { LangProvider } from "../components/LangProvider";
import BryntumBoard, { type BoardProps } from "../components/schedule/BryntumBoard";
import { ScheduleView } from "../components/schedule/ScheduleView";
import type { SchedulePage } from "../lib/server/schedule";
import { fakeMatchMedia } from "./helpers/render";

type Drop = { context: Record<string, unknown> & { finalize: (ok: boolean) => void } };
type Props = Record<string, unknown> & {
  events: { id: string; cls: string; label: string }[];
  onBeforeEventDropFinalize: (e: Drop) => void;
};

const seen = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock("@bryntum/scheduler-react", () => ({
  BryntumScheduler: (props: Record<string, unknown>) => {
    seen.props = props;
    return null;
  },
}));
const actions = vi.hoisted(() => ({
  checkMoveAction: vi.fn(async () => ({ slot: { at: "2026-11-14T06:00:00.000Z" } })),
  moveBookingAction: vi.fn(async () => ({ moved: { bookingId: "0190f0a0-0000-7000-8000-00000000000b" } })),
  cancelBookingAction: vi.fn(async () => null),
  confirmRequestAction: vi.fn(async () => null),
  declineRequestAction: vi.fn(async () => null),
}));
vi.mock("../app/app/calendar/actions", () => actions);

beforeEach(() => {
  seen.props = null;
  for (const f of Object.values(actions)) f.mockClear();
  vi.stubGlobal("matchMedia", fakeMatchMedia(false));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const WEB = path.join(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", ".next", "test", ".screenshots"]);
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const at = path.join(dir, name);
    if (statSync(at).isDirectory()) return SKIP.has(name) ? [] : walk(at);
    return /\.(ts|tsx|mts|js|mjs|cjs)$/.test(name) ? [at] : [];
  });
}

test("one client file imports Bryntum, and only next/dynamic with SSR off reaches it", () => {
  const files = walk(WEB).map((f) => ({ file: path.relative(WEB, f).split(path.sep).join("/"), text: readFileSync(f, "utf8") }));
  expect(files.length).toBeGreaterThan(100);
  // Red-proofs of the scan itself (it reads source text, so a planted text stands in for a changed file).
  if (sabotageIs("web-schedule-server-import")) files.push({ file: "lib/server/board.ts", text: 'import "server-only";\nimport { Scheduler } from "@bryntum/scheduler";\n' });
  if (sabotageIs("web-schedule-ssr")) {
    const view = files.find((f) => f.file === "components/schedule/ScheduleView.tsx");
    if (view) view.text = view.text.replace("{ ssr: false,", "{ ssr: true,");
  }
  const importers = files.filter((f) => /(from\s*|import\s*\(?\s*)["']@bryntum\//.test(f.text)).map((f) => f.file);
  expect(importers).toEqual(["components/schedule/BryntumBoard.tsx"]);
  const board = files.find((f) => f.file === "components/schedule/BryntumBoard.tsx")?.text ?? "";
  expect(board.startsWith('"use client";')).toBe(true);
  const reach = files.filter((f) => f.file !== "components/schedule/BryntumBoard.tsx" && /BryntumBoard["']/.test(f.text)).map((f) => f.file);
  expect(reach).toEqual(["components/schedule/ScheduleView.tsx"]);
  const view = files.find((f) => f.file === "components/schedule/ScheduleView.tsx")?.text ?? "";
  expect(view.startsWith('"use client";')).toBe(true);
  expect(view).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\("\.\/BryntumBoard"\),\s*\{\s*ssr:\s*false\b/);
  // Its only static import of the board is of types, which the compiler erases.
  expect(view.match(/^import\s.*from\s+"\.\/BryntumBoard";$/gm)).toEqual(['import type { BoardEvent } from "./BryntumBoard";']);
});

const R1 = "s1:a";
const R2 = "s1:b";
const BOARD: BoardProps = {
  day: "2026-11-14",
  fromHour: 9,
  toHour: 21,
  vertical: false,
  grouped: false,
  columnTitle: "Stylist",
  resources: [{ id: R1, name: "Sample A", shop: "Sample branch", note: null }],
  events: [{ id: "b1", resourceId: R1, startMin: 600, endMin: 645, title: "Cut", label: "Confirmed", state: "confirmed", draggable: true }],
  ranges: [],
  onDrop: vi.fn(),
  onPick: vi.fn(),
};

test("the board edits nothing: every editing feature off, and a drop undone in Bryntum's store and reported", () => {
  const onDrop = vi.fn();
  render(<BryntumBoard {...BOARD} onDrop={onDrop} />);
  const p = seen.props as Props;
  for (const f of ["eventEditFeature", "eventMenuFeature", "scheduleMenuFeature", "eventDragCreateFeature", "eventResizeFeature", "cellEditFeature"]) expect(p[f], f).toBe(false);
  expect(p.events).toMatchObject([{ id: "b1", cls: "sched-ev sched-confirmed", resizable: false, draggable: true }]);
  const finalize = vi.fn();
  const context: Drop["context"] = {
    async: false,
    eventRecord: { id: "b1" },
    resourceRecord: { id: R1 },
    newResource: { id: R2 },
    startDate: new Date(2026, 10, 14, 11, 30),
    finalize,
  };
  p.onBeforeEventDropFinalize({ context });
  expect(context.async).toBe(true);
  expect(finalize.mock.calls).toEqual([[false]]);
  expect(onDrop.mock.calls).toEqual([["b1", R2, 690]]);
});

const PAGE: SchedulePage = {
  member: { name: "Sample owner", role: "owner" },
  shop: "Sample salon",
  snapshots: [],
  may: ["booking.confirm"],
  formKey: "0190f0a0-0000-7000-8000-0000000000aa",
  day: "2026-11-14",
  prevDay: "2026-11-13",
  nextDay: "2026-11-15",
  shops: [{ id: "0190f0a0-0000-7000-8000-000000000001", name: "Sample branch" }],
  resources: [
    { id: "0190f0a0-0000-7000-8000-000000000001:0190f0a0-0000-7000-8000-0000000000a1", staffId: "0190f0a0-0000-7000-8000-0000000000a1", shopId: "0190f0a0-0000-7000-8000-000000000001", name: "Sample A", shop: "Sample branch", mark: null },
    { id: "0190f0a0-0000-7000-8000-000000000001:0190f0a0-0000-7000-8000-0000000000a2", staffId: "0190f0a0-0000-7000-8000-0000000000a2", shopId: "0190f0a0-0000-7000-8000-000000000001", name: "Sample B", shop: "Sample branch", mark: "present" },
  ],
  events: [
    {
      id: "0190f0a0-0000-7000-8000-0000000000b1",
      resourceId: "0190f0a0-0000-7000-8000-000000000001:0190f0a0-0000-7000-8000-0000000000a1",
      startsAt: "2026-11-14T04:30:00.000Z",
      endsAt: "2026-11-14T05:15:00.000Z",
      startMin: 600,
      endMin: 645,
      state: "confirmed",
      source: "app",
      service: "Sample cut",
      who: "Sample customer",
      movable: true,
    },
  ],
  ranges: [],
  fromHour: 9,
  toHour: 21,
  canMove: true,
};

test("a drop on the page is a proposal: a read checks it, a ghost shows beside the faded original, and only Confirm sends the move", async () => {
  render(
    <LangProvider initial="en">
      <ScheduleView data={PAGE} />
    </LangProvider>,
  );
  await waitFor(() => expect(seen.props).not.toBeNull());
  const [b1] = PAGE.events;
  const to = PAGE.resources[1];
  if (!b1 || !to) throw new Error("test: sample page");
  const finalize = vi.fn();
  await act(async () => {
    (seen.props as Props).onBeforeEventDropFinalize({
      context: { async: false, eventRecord: { id: b1.id }, resourceRecord: { id: b1.resourceId }, newResource: { id: to.id }, startDate: new Date(2026, 10, 14, 11, 30), finalize },
    });
  });
  expect(finalize.mock.calls).toEqual([[false]]);
  await waitFor(() => expect(actions.checkMoveAction).toHaveBeenCalledTimes(1));
  const form = (actions.checkMoveAction.mock.calls[0] as unknown as [unknown, FormData])[1];
  expect(Object.fromEntries(form)).toEqual({ booking: b1.id, shop: to.shopId, staff: to.staffId, day: PAGE.day, minute: "690" });
  expect(actions.moveBookingAction).not.toHaveBeenCalled();

  await waitFor(() => expect((seen.props as Props).events.map((e) => [e.id, e.cls])).toEqual([
    [b1.id, "sched-ev sched-confirmed sched-moving"],
    [`${b1.id}~proposed`, "sched-ev sched-proposed"],
  ]));
  expect((seen.props as Props).events[1]?.label).toBe("Proposed move: not saved");
  expect(screen.getByRole("heading", { name: "Proposed move" })).toBeTruthy();
  const confirm = screen.getByRole("button", { name: "Confirm the move" }) as HTMLButtonElement;
  await waitFor(() => expect(confirm.disabled).toBe(false));
  expect(actions.moveBookingAction).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.click(confirm);
  });
  await waitFor(() => expect(actions.moveBookingAction).toHaveBeenCalledTimes(1));
  const sent = (actions.moveBookingAction.mock.calls[0] as unknown as [unknown, FormData])[1];
  expect(Object.fromEntries(sent)).toMatchObject({ booking: b1.id, shop: to.shopId, staff: to.staffId, day: PAGE.day, minute: "690" });
});
