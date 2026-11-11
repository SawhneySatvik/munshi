"use client";

// The schedule's Bryntum board: a browser-only widget, loaded by ScheduleView through next/dynamic with SSR off. Bryntum
// is never bundled: its prebuilt browser build is copied from the npm package into public/vendor/bryntum at build time
// (scripts/vendor-bryntum.ts) and loaded here as a script of the app's own origin, which the page's strict-dynamic
// policy admits. The board draws what it is given and reports a drop; it edits nothing. Every editing feature is off,
// and a drop is always undone in Bryntum's own store: the parent shows the move as a proposal and the person confirms
// it through a server action. Times are wall-clock minutes of the shop's day, placed on the browser's clock as they are,
// so the board shows the shop's hours whatever the browser's zone.
import { useEffect, useMemo, useRef, useState } from "react";

export type BoardResource = { id: string; name: string; shop: string; note: string | null };
export type BoardEvent = {
  id: string;
  resourceId: string;
  startMin: number;
  endMin: number;
  title: string;
  label: string;
  state: string;
  draggable: boolean;
  moving?: boolean;
};
export type BoardRange = { id: string; resourceId: string; startMin: number; endMin: number; kind: string; label: string };
export type BoardProps = {
  day: string;
  fromHour: number;
  toHour: number;
  vertical: boolean;
  grouped: boolean;
  columnTitle: string;
  unavailable: string;
  resources: BoardResource[];
  events: BoardEvent[];
  ranges: BoardRange[];
  onDrop: (bookingId: string, resourceId: string, minute: number) => void;
  onPick: (bookingId: string) => void;
};

type Widget = { destroy(): void };
type Api = { Scheduler: new (config: Record<string, unknown>) => Widget };
type Drop = { context: { async: boolean; eventRecord: { id: unknown }; resourceRecord: { id: unknown }; newResource?: { id: unknown }; startDate: Date; finalize: (ok: boolean) => void } };
type Rendered = { eventRecord: { id: unknown; name?: unknown; label?: unknown } };

export const BRYNTUM_BASE = "/vendor/bryntum";
const SHEETS = ["scheduler.css", "stockholm-light.css", "fontawesome/css/fontawesome.css", "fontawesome/css/solid.css"];

declare global {
  interface Window {
    bryntum?: { scheduler?: Api };
  }
}

let loading: Promise<Api> | null = null;

/** Bryntum's browser build, loaded once per page: its stylesheets, then its script, which sets window.bryntum. */
export function loadBryntum(): Promise<Api> {
  const ready = window.bryntum?.scheduler;
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise<Api>((resolve, reject) => {
    for (const sheet of SHEETS) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `${BRYNTUM_BASE}/${sheet}`;
      document.head.append(link);
    }
    const script = document.createElement("script");
    script.src = `${BRYNTUM_BASE}/scheduler.umd.js`;
    script.async = true;
    script.onload = () => {
      const api = window.bryntum?.scheduler;
      if (api) resolve(api);
      else reject(new Error("bryntum: no scheduler"));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("bryntum: not loaded"));
    };
    document.head.append(script);
  });
  return loading;
}

function at(day: string, minute: number): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y as number, (m as number) - 1, d as number, 0, minute);
}

type Handlers = { onDrop: BoardProps["onDrop"]; onPick: BoardProps["onPick"] };

/** The board's whole configuration, as Bryntum's Scheduler takes it. Handlers are read at call time, so a parent's new
 * closures never rebuild the board. */
export function boardConfig(p: Omit<BoardProps, "onDrop" | "onPick" | "unavailable">, handlers: () => Handlers): Record<string, unknown> {
  return {
    height: "100%",
    mode: p.vertical ? "vertical" : "horizontal",
    startDate: at(p.day, p.fromHour * 60),
    endDate: at(p.day, p.toHour * 60),
    viewPreset: "hourAndDay",
    timeResolution: { unit: "minute", increment: 15 },
    rowHeight: 64,
    barMargin: 6,
    eventStyle: "tonal",
    resources: p.resources.map((r) => ({ id: r.id, name: r.note ? `${r.name} · ${r.note}` : r.name, shop: r.shop })),
    events: p.events.map((e) => ({
      id: e.id,
      resourceId: e.resourceId,
      startDate: at(p.day, e.startMin),
      endDate: at(p.day, e.endMin),
      name: e.title,
      label: e.label,
      cls: `sched-ev sched-${e.state}${e.moving ? " sched-moving" : ""}`,
      draggable: e.draggable,
      resizable: false,
    })),
    resourceTimeRanges: p.ranges.map((r) => ({
      id: r.id,
      resourceId: r.resourceId,
      startDate: at(p.day, r.startMin),
      endDate: at(p.day, r.endMin),
      name: r.label,
      cls: `sched-range sched-range-${r.kind}`,
    })),
    columns: [{ text: p.columnTitle, field: "name", width: 190 }],
    resourceColumns: { columnWidth: 140 },
    features: {
      group: p.grouped && !p.vertical ? "shop" : false,
      resourceTimeRanges: true,
      eventDrag: { constrainDragToTimeline: true },
      eventEdit: false,
      eventMenu: false,
      scheduleMenu: false,
      eventDragCreate: false,
      eventResize: false,
      cellEdit: false,
    },
    zoomOnMouseWheel: false,
    zoomOnTimeAxisDoubleClick: false,
    eventRenderer: ({ eventRecord }: Rendered) => [
      { tag: "b", className: "sched-ev-title", text: String(eventRecord.name ?? "") },
      { tag: "span", className: "sched-ev-label", text: String(eventRecord.label ?? "") },
    ],
    listeners: {
      eventClick: ({ eventRecord }: Rendered) => handlers().onPick(String(eventRecord.id)),
      beforeEventDropFinalize: ({ context }: Drop) => {
        context.async = true;
        const to = context.newResource ?? context.resourceRecord;
        const start = context.startDate;
        context.finalize(false);
        handlers().onDrop(String(context.eventRecord.id), String(to.id), start.getHours() * 60 + start.getMinutes());
      },
    },
  };
}

export default function BryntumBoard(p: BoardProps) {
  const host = useRef<HTMLDivElement>(null);
  const handlers = useRef<Handlers>({ onDrop: p.onDrop, onPick: p.onPick });
  handlers.current = { onDrop: p.onDrop, onPick: p.onPick };
  const [failed, setFailed] = useState(false);
  const { day, fromHour, toHour, vertical, grouped, columnTitle, resources, events, ranges } = p;
  // The parent rebuilds its arrays on every render; the board is rebuilt only when what it draws changes.
  const drawn = JSON.stringify({ day, fromHour, toHour, vertical, grouped, columnTitle, resources, events, ranges });
  const config = useMemo(() => boardConfig(JSON.parse(drawn), () => handlers.current), [drawn]);

  useEffect(() => {
    let live = true;
    let board: Widget | null = null;
    loadBryntum().then(
      (api) => {
        if (live && host.current) board = new api.Scheduler({ ...config, appendTo: host.current });
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
      board?.destroy();
    };
  }, [config]);

  if (failed) return <p className="field-note">{p.unavailable}</p>;
  return <div ref={host} style={{ height: "100%" }} />;
}
