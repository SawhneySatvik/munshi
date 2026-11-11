"use client";

// The one file that imports Bryntum: a browser-only widget, loaded by ScheduleView through next/dynamic with SSR off,
// so no server render and no test of a page ever loads it. It draws what it is given and reports a drop; it edits
// nothing. Every editing feature is off, and a drop is always undone in Bryntum's own store: the parent shows the move
// as a proposal and the person confirms it through a server action. Times are wall-clock minutes of the shop's day,
// placed on the browser's clock as they are, so the board shows the shop's hours whatever the browser's zone.
import "@bryntum/scheduler/scheduler.css";
import "@bryntum/scheduler/stockholm-light.css";
import "@bryntum/scheduler/fontawesome/css/fontawesome.css";
import "@bryntum/scheduler/fontawesome/css/solid.css";
import { BryntumScheduler } from "@bryntum/scheduler-react";
import { useMemo } from "react";

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
  resources: BoardResource[];
  events: BoardEvent[];
  ranges: BoardRange[];
  onDrop: (bookingId: string, resourceId: string, minute: number) => void;
  onPick: (bookingId: string) => void;
};

function at(day: string, minute: number): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y as number, (m as number) - 1, d as number, 0, minute);
}

export default function BryntumBoard(p: BoardProps) {
  const resources = useMemo(() => p.resources.map((r) => ({ id: r.id, name: r.note ? `${r.name} · ${r.note}` : r.name, shop: r.shop })), [p.resources]);
  const events = useMemo(
    () =>
      p.events.map((e) => ({
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
    [p.events, p.day],
  );
  const ranges = useMemo(
    () =>
      p.ranges.map((r) => ({
        id: r.id,
        resourceId: r.resourceId,
        startDate: at(p.day, r.startMin),
        endDate: at(p.day, r.endMin),
        name: r.label,
        cls: `sched-range sched-range-${r.kind}`,
      })),
    [p.ranges, p.day],
  );

  return (
    <BryntumScheduler
      mode={p.vertical ? "vertical" : "horizontal"}
      startDate={at(p.day, p.fromHour * 60)}
      endDate={at(p.day, p.toHour * 60)}
      viewPreset="hourAndDay"
      timeResolution={{ unit: "minute", increment: 15 }}
      rowHeight={64}
      barMargin={6}
      eventStyle="tonal"
      resources={resources}
      events={events}
      resourceTimeRanges={ranges}
      columns={[{ text: p.columnTitle, field: "name", width: 190 }]}
      resourceColumns={{ columnWidth: 140 }}
      groupFeature={p.grouped && !p.vertical ? "shop" : false}
      resourceTimeRangesFeature
      eventDragFeature={{ constrainDragToTimeline: true }}
      eventEditFeature={false}
      eventMenuFeature={false}
      scheduleMenuFeature={false}
      eventDragCreateFeature={false}
      eventResizeFeature={false}
      cellEditFeature={false}
      zoomOnMouseWheel={false}
      zoomOnTimeAxisDoubleClick={false}
      eventRenderer={({ eventRecord }) => [
        { tag: "b", className: "sched-ev-title", text: String(eventRecord.name ?? "") },
        { tag: "span", className: "sched-ev-label", text: String((eventRecord as unknown as { label?: string }).label ?? "") },
      ]}
      onEventClick={({ eventRecord }) => p.onPick(String(eventRecord.id))}
      onBeforeEventDropFinalize={({ context }) => {
        context.async = true;
        const to = context.newResource ?? context.resourceRecord;
        const start = context.startDate;
        context.finalize(false);
        p.onDrop(String(context.eventRecord.id), String(to.id), start.getHours() * 60 + start.getMinutes());
      }}
    />
  );
}
