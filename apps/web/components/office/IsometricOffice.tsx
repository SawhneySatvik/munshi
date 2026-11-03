"use client";

// The isometric back office: the room, the desks, the tray and the agents walking between them, driven only by props
// (types.ts). Seen from above (with zoom and pan), from the owner's desk, or following one agent. The room's palette,
// the agents' look and the camera are view state the host passes in; nothing here writes anything.
import { Fragment, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "../../lib/types";
import { AgentCharacter } from "./characters";
import { OfficeControls, type OfficeView } from "./OfficeControls";
import { type AgentStyleId, type CameraViewMode, type EnvironmentPresetId, OFFICE_WORDS, PRESET_VARS } from "./presets";
import type { Agent, AgentId, GridCoord, OfficeEvent, OfficeProps } from "./types";
import "./scene.css";

type SpotId = NonNullable<Agent["walkTo"]>;
interface ActiveWalk {
  path: GridCoord[];
  cumulative: number[];
  totalDist: number;
  durationMs: number;
  startTime: number;
  targetKey: string;
}
interface ActiveFx {
  eventId: string;
  kind: OfficeEvent["kind"];
  agent: AgentId;
  startTime: number;
  durationMs: number;
}
interface ScreenCoord {
  x: number;
  y: number;
}

// Window light by the hour, read from the time's own digits (the shop's local time), never the browser's clock.
function parseTimeOfDay(iso: string) {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  const hours = m ? Number(m[1]) : 10;
  const minutes = m ? Number(m[2]) : 30;
  if (hours >= 6 && hours < 12) return { hours, minutes, windowOpacity: 0.92, beamOpacity: 0.24 };
  if (hours >= 12 && hours < 17) return { hours, minutes, windowOpacity: 1, beamOpacity: 0.32 };
  if (hours >= 17 && hours < 20) return { hours, minutes, windowOpacity: 0.65, beamOpacity: 0.16 };
  return { hours, minutes, windowOpacity: 0.3, beamOpacity: 0.06 };
}

// A line the scene shows is the host's own text. A figure in it would be a number no stored row backs, so such a line
// shows "Cannot verify" instead. (Latin and Devanagari digits, and the rupee sign.)
const FIGURE = /[0-9\u0966-\u096F\u20B9]/;
function lineText(text: string, cannotVerify: string, max: number): string {
  if (FIGURE.test(text)) return cannotVerify;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const GRID_SIZE = 10;
const TILE_W = 104;
const TILE_H = 52;
const ORIGIN_X = 680;
const ORIGIN_Y = 148;
const SVG_W = 1440;
const SVG_H = 820;
const WALL_H = 340;

function isoToScreen(gx: number, gy: number, gz = 0): ScreenCoord {
  return { x: ORIGIN_X + (gx - gy) * (TILE_W / 2), y: ORIGIN_Y + (gx + gy) * (TILE_H / 2) - gz };
}

const DESK_CONFIG: Record<AgentId, { deskPos: GridCoord; standPos: GridCoord; peerPos: GridCoord }> = {
  munshi: { deskPos: { gx: 4.5, gy: 4.5 }, standPos: { gx: 4.5, gy: 5.45 }, peerPos: { gx: 5.5, gy: 4.6 } },
  tally: { deskPos: { gx: 1.8, gy: 1.8 }, standPos: { gx: 2.7, gy: 1.8 }, peerPos: { gx: 2.9, gy: 2.3 } },
  ledger: { deskPos: { gx: 1.8, gy: 5.2 }, standPos: { gx: 2.7, gy: 5.2 }, peerPos: { gx: 2.9, gy: 5.5 } },
  dash: { deskPos: { gx: 4.5, gy: 7.0 }, standPos: { gx: 5.4, gy: 7.0 }, peerPos: { gx: 5.6, gy: 7.0 } },
  echo: { deskPos: { gx: 5.4, gy: 1.8 }, standPos: { gx: 5.4, gy: 2.7 }, peerPos: { gx: 5.4, gy: 2.9 } },
  bloom: { deskPos: { gx: 7.8, gy: 2.8 }, standPos: { gx: 6.9, gy: 2.8 }, peerPos: { gx: 6.7, gy: 3.1 } },
  keeper: { deskPos: { gx: 7.8, gy: 5.8 }, standPos: { gx: 6.9, gy: 5.8 }, peerPos: { gx: 6.7, gy: 5.8 } },
};

const SPECIAL_SPOTS = {
  trayTable: { gx: 7.8, gy: 8.0 },
  trayApproach: { gx: 6.9, gy: 7.7 },
  shelfFurniture: { gx: 0.75, gy: 3.4 },
  shelfStand: { gx: 1.65, gy: 3.4 },
  door: { gx: 0.8, gy: 8.2 },
  loungeTable: { gx: 2.0, gy: 8.1 },
  vaultCabinet: { gx: 8.4, gy: 1.1 },
} satisfies Record<string, GridCoord>;

const TRAY_WAITING_SLOTS: Record<AgentId, GridCoord> = {
  dash: { gx: 6.9, gy: 8.1 },
  ledger: { gx: 7.7, gy: 7.0 },
  tally: { gx: 6.4, gy: 7.5 },
  echo: { gx: 8.4, gy: 7.0 },
  bloom: { gx: 6.3, gy: 8.4 },
  keeper: { gx: 7.2, gy: 6.8 },
  munshi: { gx: 6.9, gy: 7.2 },
};

function resolveTargetCoord(agentId: AgentId, spot: SpotId, forWaiting = false): GridCoord {
  if (forWaiting) return TRAY_WAITING_SLOTS[agentId];
  switch (spot) {
    case "desk":
      return DESK_CONFIG[agentId].standPos;
    case "lead":
      return agentId === "munshi" ? DESK_CONFIG.munshi.standPos : DESK_CONFIG.munshi.peerPos;
    case "tray":
      return TRAY_WAITING_SLOTS[agentId];
    case "shelf":
      return SPECIAL_SPOTS.shelfStand;
    case "door":
      return SPECIAL_SPOTS.door;
    default:
      return DESK_CONFIG[spot]?.peerPos ?? DESK_CONFIG[agentId].standPos;
  }
}

function getRestingCoord(agent: Agent): GridCoord {
  return agent.state === "waiting" ? resolveTargetCoord(agent.id, "tray", true) : DESK_CONFIG[agent.id].standPos;
}

const OBSTACLE_BOXES: Array<{ minX: number; maxX: number; minY: number; maxY: number }> = [
  { minX: 3.95, maxX: 5.05, minY: 3.95, maxY: 5.05 },
  { minX: 1.3, maxX: 2.3, minY: 1.3, maxY: 2.3 },
  { minX: 1.3, maxX: 2.3, minY: 4.7, maxY: 5.7 },
  { minX: 4.0, maxX: 5.0, minY: 6.5, maxY: 7.5 },
  { minX: 4.9, maxX: 5.9, minY: 1.3, maxY: 2.3 },
  { minX: 7.3, maxX: 8.3, minY: 2.3, maxY: 3.3 },
  { minX: 7.3, maxX: 8.3, minY: 5.3, maxY: 6.3 },
  { minX: 0.2, maxX: 1.25, minY: 2.9, maxY: 3.9 },
  { minX: 7.3, maxX: 8.35, minY: 7.5, maxY: 8.55 },
  { minX: 1.45, maxX: 2.55, minY: 7.6, maxY: 8.6 },
];

function isPointBlocked(gx: number, gy: number): boolean {
  if (gx < 0.5 || gx > 9.3 || gy < 0.5 || gy > 9.3) return true;
  return OBSTACLE_BOXES.some((b) => gx >= b.minX && gx <= b.maxX && gy >= b.minY && gy <= b.maxY);
}

// A path's point at an index the loop keeps inside the array.
const pt = (points: GridCoord[], i: number): GridCoord => points[i] as GridCoord;

function simplifyPath(points: GridCoord[]): GridCoord[] {
  if (points.length <= 2) return points;
  const out: GridCoord[] = [pt(points, 0)];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = pt(out, out.length - 1);
    const curr = pt(points, i);
    const next = pt(points, i + 1);
    const cross = Math.abs((curr.gx - prev.gx) * (next.gy - curr.gy) - (curr.gy - prev.gy) * (next.gx - curr.gx));
    if (cross > 0.01) out.push(curr);
  }
  out.push(pt(points, points.length - 1));
  return out;
}

// A* on a half-tile grid around the furniture, diagonal steps allowed where neither side is blocked.
function computeGridPath(start: GridCoord, goal: GridCoord): GridCoord[] {
  const snap = (v: number) => Math.round(v * 2) / 2;
  const s: GridCoord = { gx: snap(start.gx), gy: snap(start.gy) };
  const g: GridCoord = { gx: snap(goal.gx), gy: snap(goal.gy) };
  if (Math.hypot(s.gx - g.gx, s.gy - g.gy) < 0.25) return [goal];

  const key = (p: GridCoord) => `${p.gx.toFixed(1)},${p.gy.toFixed(1)}`;
  const open: GridCoord[] = [s];
  const cameFrom = new Map<string, GridCoord>();
  const gScore = new Map<string, number>([[key(s), 0]]);
  const fScore = new Map<string, number>([[key(s), Math.hypot(g.gx - s.gx, g.gy - s.gy)]]);
  const closed = new Set<string>();
  const dirs = [
    { dx: 0.5, dy: 0 },
    { dx: -0.5, dy: 0 },
    { dx: 0, dy: 0.5 },
    { dx: 0, dy: -0.5 },
    { dx: 0.5, dy: 0.5 },
    { dx: 0.5, dy: -0.5 },
    { dx: -0.5, dy: 0.5 },
    { dx: -0.5, dy: -0.5 },
  ];

  let iterations = 0;
  while (open.length > 0 && iterations < 500) {
    iterations++;
    open.sort((a, b) => (fScore.get(key(a)) ?? 999) - (fScore.get(key(b)) ?? 999));
    const current = open.shift() as GridCoord;
    const cKey = key(current);
    if (Math.hypot(current.gx - g.gx, current.gy - g.gy) <= 0.55) {
      const path: GridCoord[] = [goal];
      let curr: GridCoord | undefined = current;
      while (curr && key(curr) !== key(s)) {
        path.unshift(curr);
        curr = cameFrom.get(key(curr));
      }
      path.unshift(start);
      return simplifyPath(path);
    }
    closed.add(cKey);
    for (const d of dirs) {
      const next: GridCoord = { gx: Math.round((current.gx + d.dx) * 2) / 2, gy: Math.round((current.gy + d.dy) * 2) / 2 };
      const nKey = key(next);
      if (closed.has(nKey)) continue;
      const isGoal = Math.hypot(next.gx - g.gx, next.gy - g.gy) < 0.35;
      if (!isGoal && isPointBlocked(next.gx, next.gy)) continue;
      if (d.dx !== 0 && d.dy !== 0 && (isPointBlocked(current.gx + d.dx, current.gy) || isPointBlocked(current.gx, current.gy + d.dy))) continue;
      const tentativeG = (gScore.get(cKey) ?? 0) + Math.hypot(d.dx, d.dy);
      if (tentativeG < (gScore.get(nKey) ?? Number.POSITIVE_INFINITY)) {
        cameFrom.set(nKey, current);
        gScore.set(nKey, tentativeG);
        fScore.set(nKey, tentativeG + Math.hypot(g.gx - next.gx, g.gy - next.gy));
        if (!open.some((p) => key(p) === nKey)) open.push(next);
      }
    }
  }
  return [start, goal];
}

function getPathMetrics(path: GridCoord[], agentId: AgentId) {
  const speed = agentId === "dash" ? 1.6 * 1.4 : 1.6;
  const cumulative: number[] = [0];
  let totalDist = 0;
  for (let i = 1; i < path.length; i++) {
    totalDist += Math.hypot(pt(path, i).gx - pt(path, i - 1).gx, pt(path, i).gy - pt(path, i - 1).gy);
    cumulative.push(totalDist);
  }
  return { totalDist, durationMs: Math.max(250, (totalDist / speed) * 1000), cumulative };
}

function samplePath(path: GridCoord[], cumulative: number[], totalDist: number, t: number): GridCoord {
  if (path.length === 0) return { gx: 4.5, gy: 4.5 };
  if (path.length === 1 || totalDist <= 0.001) return pt(path, path.length - 1);
  const targetDist = Math.max(0, Math.min(1, t)) * totalDist;
  for (let i = 1; i < cumulative.length; i++) {
    const end = cumulative[i] ?? 0;
    if (targetDist <= end) {
      const segStart = cumulative[i - 1] ?? 0;
      const segLen = end - segStart;
      const localT = segLen > 0 ? (targetDist - segStart) / segLen : 0;
      const a = pt(path, i - 1);
      const b = pt(path, i);
      return { gx: a.gx + (b.gx - a.gx) * localT, gy: a.gy + (b.gy - a.gy) * localT };
    }
  }
  return pt(path, path.length - 1);
}

const depthKey = (gx: number, gy: number, bias = 0) => gx + gy + bias;
const pts = (...p: ScreenCoord[]) => p.map((q) => `${q.x},${q.y}`).join(" ");

export function IsometricOffice({
  shopName,
  localTime,
  agents,
  trayCount,
  events,
  sample,
  environmentPreset = "kirana",
  agentStyle = "human",
  view = "isometric",
  chrome = true,
  interactive = true,
  lang = "en",
  onViewChange,
  onSelectAgent,
  onOpenTray,
  onOpenBrief,
}: OfficeProps & {
  environmentPreset?: EnvironmentPresetId;
  agentStyle?: AgentStyleId;
  view?: CameraViewMode;
  /** the scene's own header (the shop's name, the sample label); a host page with its own head turns it off */
  chrome?: boolean;
  /** drag to pan, Ctrl or Cmd and the wheel to zoom; off where the scene is a picture (the landing page) */
  interactive?: boolean;
  lang?: Lang;
  /** given, the scene shows its controls (room, agents' look, camera) and reports a choice here */
  onViewChange?: ((next: Partial<OfficeView>) => void) | undefined;
}) {
  const w = OFFICE_WORDS[lang];
  const [selectedAgent, setSelectedAgent] = useState<AgentId | null>(null);
  const [hoveredAgent, setHoveredAgent] = useState<AgentId | null>(null);
  const [focusedAgent, setFocusedAgent] = useState<AgentId | null>(null);
  const [followed, setFollowed] = useState<AgentId>("munshi");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [cameraZoom, setCameraZoom] = useState(1);
  const [cameraPan, setCameraPan] = useState({ x: 0, y: 0 });
  const [povYaw, setPovYaw] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const positionsRef = useRef<Record<AgentId, GridCoord>>({
    munshi: DESK_CONFIG.munshi.standPos,
    tally: DESK_CONFIG.tally.standPos,
    ledger: DESK_CONFIG.ledger.standPos,
    dash: DESK_CONFIG.dash.standPos,
    echo: DESK_CONFIG.echo.standPos,
    bloom: DESK_CONFIG.bloom.standPos,
    keeper: DESK_CONFIG.keeper.standPos,
  });
  const walksRef = useRef<Partial<Record<AgentId, ActiveWalk>>>({});
  const seenEventsRef = useRef<Set<string>>(new Set());
  const [activeFxList, setActiveFxList] = useState<ActiveFx[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onVis = () => setTabHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    if (mq) {
      setReducedMotion(mq.matches);
      mq.addEventListener("change", onChange);
    }
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      mq?.removeEventListener("change", onChange);
    };
  }, []);

  // Each agent walks (A* round the furniture) to where its state puts it; with reduced motion it is simply there.
  useEffect(() => {
    const now = performance.now();
    for (const agent of agents) {
      const currentPos = positionsRef.current[agent.id] ?? DESK_CONFIG[agent.id].standPos;
      const target = agent.state === "walking" && agent.walkTo ? resolveTargetCoord(agent.id, agent.walkTo, agent.walkTo === "tray") : getRestingCoord(agent);
      const targetKey = `${target.gx.toFixed(2)},${target.gy.toFixed(2)}`;
      if (reducedMotion || Math.hypot(currentPos.gx - target.gx, currentPos.gy - target.gy) < 0.08) {
        positionsRef.current[agent.id] = target;
        delete walksRef.current[agent.id];
        continue;
      }
      if (walksRef.current[agent.id]?.targetKey !== targetKey) {
        const path = computeGridPath(currentPos, target);
        walksRef.current[agent.id] = { path, ...getPathMetrics(path, agent.id), startTime: now, targetKey };
      }
    }
    setTick((t) => t + 1);
  }, [agents, reducedMotion]);

  // Each event plays once (its id is remembered) and is said aloud to a screen reader.
  useEffect(() => {
    const now = performance.now();
    const fresh: ActiveFx[] = [];
    const said: string[] = [];
    for (const ev of events) {
      if (seenEventsRef.current.has(ev.id)) continue;
      seenEventsRef.current.add(ev.id);
      const name = agents.find((a) => a.id === ev.agent)?.name ?? ev.agent;
      said.push(w.said[ev.kind](name));
      const durationMs = ev.kind === "finding" || ev.kind === "draft" ? 2400 : ev.kind === "approved" ? 2200 : 2000;
      fresh.push({ eventId: ev.id, kind: ev.kind, agent: ev.agent, startTime: now, durationMs });
    }
    if (said.length > 0) setAnnouncement(said.join(" "));
    if (fresh.length > 0) setActiveFxList((prev) => [...prev, ...fresh]);
  }, [events, agents, w]);

  useEffect(() => {
    if (tabHidden) return;
    let rafId: number | null = null;
    const step = (now: number) => {
      let moving = false;
      for (const id of Object.keys(walksRef.current) as AgentId[]) {
        const walk = walksRef.current[id];
        if (!walk) continue;
        const progress = Math.min(1, (now - walk.startTime) / walk.durationMs);
        positionsRef.current[id] = samplePath(walk.path, walk.cumulative, walk.totalDist, progress);
        if (progress >= 1) delete walksRef.current[id];
        else moving = true;
      }
      setActiveFxList((prev) => {
        const remaining = prev.filter((fx) => now - fx.startTime < fx.durationMs);
        if (remaining.length > 0) moving = true;
        return remaining.length === prev.length ? prev : remaining;
      });
      setTick((t) => (t + 1) % 100000);
      if (moving || Object.keys(walksRef.current).length > 0) rafId = requestAnimationFrame(step);
    };
    if (Object.keys(walksRef.current).length > 0 || activeFxList.length > 0) rafId = requestAnimationFrame(step);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [activeFxList.length, tabHidden, agents]); // a walk with no event attached starts the loop too

  // Ctrl or Cmd with the wheel zooms the room; a plain wheel scrolls the page as ever. React's wheel listener is
  // passive, so the room listens itself.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !interactive || view !== "isometric") return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setCameraZoom((z) => Math.max(0.75, Math.min(2.2, +(z + (e.deltaY < 0 ? 0.08 : -0.08)).toFixed(2))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [interactive, view]);

  const timeInfo = useMemo(() => parseTimeOfDay(localTime), [localTime]);
  const posOf = (id: AgentId) => positionsRef.current[id] ?? DESK_CONFIG[id].standPos;
  // Where an agent stands in the view from the owner's desk: the room's grid folded into eye-level perspective, the
  // nearer the larger.
  const povPlace = (id: AgentId) => {
    const pos = posOf(id);
    const depthNorm = Math.max(0.08, Math.min(0.95, (pos.gx + pos.gy - 2) / 14));
    const horizNorm = (pos.gx - pos.gy + 7) / 14;
    return { px: 720 + (horizNorm - 0.5) * (920 + depthNorm * 640), py: 448 + depthNorm * 215, scale: 0.78 + depthNorm * 0.72 };
  };

  // The camera moves the room and the buttons laid over it together, so each button stays on what it names. Following
  // an agent centres the room on it (as a share of the frame, so it holds at any width) and stays with it as it walks.
  let cameraTransform = `translate(${cameraPan.x}px, ${cameraPan.y}px) scale(${cameraZoom})`;
  if (view === "pov_agent") {
    const s = 1.7;
    const p = isoToScreen(posOf(followed).gx, posOf(followed).gy, 30);
    const tx = (-s * (p.x - SVG_W / 2) * 100) / SVG_W;
    const ty = (-s * (p.y - SVG_H / 2) * 100) / SVG_H;
    cameraTransform = `translate(${tx.toFixed(2)}%, ${ty.toFixed(2)}%) scale(${s})`;
  }

  const panning = interactive && view !== "pov_agent";
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!panning || e.pointerType === "touch" || (e.target as HTMLElement).closest("button")) return;
    setDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: view === "isometric" ? cameraPan.x : povYaw, panY: cameraPan.y };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!dragging || !start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (view === "pov_owner") setPovYaw(Math.max(-320, Math.min(320, start.panX + dx)));
    else setCameraPan({ x: Math.max(-520, Math.min(520, start.panX + dx)), y: Math.max(-340, Math.min(340, start.panY + dy)) });
  };
  const onPointerUp = () => {
    setDragging(false);
    dragStartRef.current = null;
  };

  const handleAgentClick = (id: AgentId) => {
    setSelectedAgent(id);
    onSelectAgent(id);
  };

  const trayLabel = trayCount > 0 ? `${w.tray} · ${trayCount}` : w.tray;
  const agentLabel = (agent: Agent) => {
    const line = agent.line ? `. ${lineText(agent.line.text, w.cannotVerify, 200)}${agent.line.source ? ` (${agent.line.source.label})` : ""}` : "";
    return `${agent.name}, ${agent.role.toLowerCase()}, ${agent.state}${line}. ${w.talkTo} ${agent.name}`;
  };
  const trayAria =
    lang === "hi"
      ? "आपकी मंज़ूरी की ट्रे: ड्राफ़्ट देखें और मंज़ूर करें"
      : trayCount > 0
        ? `Your approval tray, ${trayCount} ${trayCount === 1 ? "draft" : "drafts"} waiting. Open tray to review and approve`
        : "Your approval tray. Open it to review and approve drafts";
  const briefAria = lang === "hi" ? "सुबह की रिपोर्ट का बोर्ड: आज की रिपोर्ट खोलें" : "Morning brief board. Open today's shop brief";

  const sortedSceneItems = useMemo(() => {
    type SceneItem =
      | { kind: "desk"; agentId: AgentId; agent?: Agent | undefined; gx: number; gy: number; depth: number }
      | { kind: "shelf" | "tray" | "lounge" | "vault"; gx: number; gy: number; depth: number }
      | { kind: "plant"; id: string; gx: number; gy: number; depth: number }
      | { kind: "agent"; agent: Agent; gx: number; gy: number; depth: number };
    const items: SceneItem[] = [];
    for (const id of Object.keys(DESK_CONFIG) as AgentId[]) {
      const { deskPos } = DESK_CONFIG[id];
      items.push({ kind: "desk", agentId: id, agent: agents.find((a) => a.id === id), gx: deskPos.gx, gy: deskPos.gy, depth: depthKey(deskPos.gx, deskPos.gy) });
    }
    const at = (kind: "shelf" | "tray" | "lounge" | "vault", p: GridCoord, bias = 0) => items.push({ kind, gx: p.gx, gy: p.gy, depth: depthKey(p.gx, p.gy, bias) });
    at("shelf", SPECIAL_SPOTS.shelfFurniture);
    at("vault", SPECIAL_SPOTS.vaultCabinet);
    at("lounge", SPECIAL_SPOTS.loungeTable);
    at("tray", SPECIAL_SPOTS.trayTable, 0.05);
    items.push({ kind: "plant", id: "corner-plant-1", gx: 0.7, gy: 0.7, depth: depthKey(0.7, 0.7) });
    items.push({ kind: "plant", id: "corner-plant-2", gx: 9.1, gy: 4.2, depth: depthKey(9.1, 4.2) });
    for (const ag of agents) {
      const pos = positionsRef.current[ag.id] ?? DESK_CONFIG[ag.id].standPos;
      items.push({ kind: "agent", agent: ag, gx: pos.gx, gy: pos.gy, depth: depthKey(pos.gx, pos.gy, 0.12) });
    }
    return items.sort((a, b) => a.depth - b.depth);
  }, [agents, tick]); // tick: the positions live in a ref and move every frame

  const topCorner = isoToScreen(0, 0);
  const rightCorner = isoToScreen(GRID_SIZE, 0);
  const bottomCorner = isoToScreen(GRID_SIZE, GRID_SIZE);
  const leftCorner = isoToScreen(0, GRID_SIZE);
  const farLeftWallEnd = isoToScreen(0, 18);
  const farRightWallEnd = isoToScreen(18, 0);
  const farBottomCorner = isoToScreen(18, 18);

  return (
    <section className="munshi-office-root" data-env={environmentPreset} data-agent-style={agentStyle} data-view={view} style={PRESET_VARS[environmentPreset]} aria-label={`${shopName} AI back office`}>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {chrome && (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px 4px", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-title)", fontSize: "19px", fontWeight: 700, letterSpacing: "-0.01em" }}>{shopName}</span>
          {sample && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                fontWeight: 600,
                padding: "3px 9px",
                borderRadius: "999px",
                background: "var(--amber-wash)",
                color: "var(--amber)",
                border: "1px solid var(--edge)",
              }}
            >
              Sample shop
            </span>
          )}
        </div>
      )}

      {onViewChange && (
        <OfficeControls
          lang={lang}
          value={{ preset: environmentPreset, style: agentStyle, view }}
          onChange={onViewChange}
          agents={agents}
          followed={followed}
          onFollow={setFollowed}
          zoom={
            view === "isometric" && interactive
              ? {
                  zoomIn: () => setCameraZoom((z) => Math.min(2.2, +(z + 0.12).toFixed(2))),
                  zoomOut: () => setCameraZoom((z) => Math.max(0.75, +(z - 0.12).toFixed(2))),
                  reset: () => {
                    setCameraZoom(1);
                    setCameraPan({ x: 0, y: 0 });
                  },
                }
              : null
          }
        />
      )}

      <div
        ref={wrapRef}
        className="munshi-diorama-wrap"
        data-pan={panning ? (dragging ? "dragging" : "") : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {view === "pov_owner" ? (
          // From the owner's desk: eye level across the room, the tray on the desk in front.
          <>
          <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-label={w.pov}>
            <defs>
              <linearGradient id="pov-ceiling" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="var(--slab-r)" />
                <stop offset="100%" stopColor="var(--wall-l)" />
              </linearGradient>
              <linearGradient id="pov-floor" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="var(--edge)" />
                <stop offset="25%" stopColor="var(--floor)" />
                <stop offset="100%" stopColor="var(--paper)" />
              </linearGradient>
            </defs>

            <g transform={`translate(${povYaw * 0.45}, 0)`}>
              {/* The ceiling with its beams */}
              <polygon points="-400,0 1840,0 1480,190 -40,190" fill="url(#pov-ceiling)" />
              {[-200, 120, 440, 720, 1000, 1320, 1640].map((bx) => (
                <line key={bx} x1={bx} y1={0} x2={720 + (bx - 720) * 0.62} y2={190} stroke="var(--ink)" strokeWidth="6" opacity="0.28" />
              ))}

              {/* The back wall and the side walls, with their panelling */}
              <rect x="110" y="190" width="1220" height="250" fill="var(--wall-l)" stroke="var(--edge)" strokeWidth="2" />
              <polygon points="-400,0 110,190 110,440 -400,720" fill="var(--wall-r)" stroke="var(--edge)" strokeWidth="2" />
              <polygon points="1840,0 1330,190 1330,440 1840,720" fill="var(--wall-r)" stroke="var(--edge)" strokeWidth="2" />
              <rect x="110" y="365" width="1220" height="75" fill="var(--slab-l)" opacity="0.55" />
              <line x1="110" y1="365" x2="1330" y2="365" stroke="var(--ink)" strokeWidth="2" opacity="0.3" />

              {/* The almirah of ledgers */}
              <g transform="translate(175, 225)">
                <rect x="0" y="0" width="135" height="205" rx="4" fill="var(--slab-r)" stroke="var(--ink)" strokeWidth="2" />
                <rect x="10" y="12" width="115" height="180" fill="var(--ink)" opacity="0.18" />
                {[42, 84, 126, 168].map((sy) => (
                  <g key={sy}>
                    <rect x="8" y={sy} width="119" height="6" fill="var(--desk-side-r)" />
                    <rect x="16" y={sy - 26} width="18" height="26" rx="2" fill="var(--coral)" />
                    <rect x="38" y={sy - 24} width="22" height="24" rx="2" fill="var(--teal)" />
                    <rect x="64" y={sy - 27} width="16" height="27" rx="2" fill="var(--amber)" />
                    <rect x="86" y={sy - 25} width="26" height="25" rx="2" fill="var(--coral-deep)" />
                  </g>
                ))}
              </g>

              {/* The brief board */}
              <g transform="translate(355, 238)">
                <rect x="0" y="0" width="165" height="112" rx="6" fill="var(--card)" stroke="var(--coral)" strokeWidth="2.5" />
                <circle cx="82" cy="10" r="4.5" fill="var(--coral)" />
                <text x="82" y="28" textAnchor="middle" fill="var(--coral)" fontSize="11" fontFamily="var(--font-mono)" fontWeight="700">
                  {w.brief}
                </text>
                <line x1="18" y1="44" x2="146" y2="44" stroke="var(--coral)" strokeWidth="3" strokeLinecap="round" />
                <line x1="18" y1="62" x2="138" y2="62" stroke="var(--slab-r)" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="18" y1="78" x2="142" y2="78" stroke="var(--slab-r)" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="18" y1="94" x2="110" y2="94" stroke="var(--slab-r)" strokeWidth="2.5" strokeLinecap="round" />
              </g>

              {/* The courtyard window, its trees and the light it lets in */}
              <g transform="translate(575, 212)">
                <rect x="0" y="0" width="390" height="168" rx="14" fill="var(--teal-wash)" opacity={timeInfo.windowOpacity} stroke="var(--ink)" strokeWidth="3" />
                <circle cx="85" cy="105" r="46" fill="var(--ok)" opacity="0.28" />
                <circle cx="145" cy="92" r="54" fill="var(--teal)" opacity="0.24" />
                <circle cx="290" cy="110" r="42" fill="var(--ok)" opacity="0.26" />
                {environmentPreset === "monsoon" && (
                  <g stroke="var(--teal)" strokeWidth="1.6" opacity="0.7">
                    {[30, 90, 150, 210, 270, 330].map((x, i) => (
                      <line key={x} x1={x} y1={20 + (i % 3) * 30} x2={x - 10} y2={48 + (i % 3) * 30} className="munshi-rain" style={{ animationDelay: `${i * 0.2}s` }} />
                    ))}
                  </g>
                )}
                <line x1="130" y1="0" x2="130" y2="168" stroke="var(--ink)" strokeWidth="2.5" />
                <line x1="260" y1="0" x2="260" y2="168" stroke="var(--ink)" strokeWidth="2.5" />
                <line x1="0" y1="84" x2="390" y2="84" stroke="var(--ink)" strokeWidth="2" />
                <polygon points="0,168 390,168 520,420 -80,420" fill="var(--teal-wash)" opacity={timeInfo.beamOpacity * 1.4} />
              </g>

              {/* The wall clock and the steel safe */}
              {(() => {
                const hr = ((((timeInfo.hours % 12) + timeInfo.minutes / 60) * 30 - 90) * Math.PI) / 180;
                const mn = ((timeInfo.minutes * 6 - 90) * Math.PI) / 180;
                return (
                  <g transform="translate(1045, 245)">
                    <circle cx="0" cy="0" r="28" fill="var(--card)" stroke="var(--ink)" strokeWidth="2.5" />
                    <circle cx="0" cy="0" r="24" fill="none" stroke="var(--amber)" strokeWidth="1" />
                    <line x1="0" y1="0" x2={Math.cos(hr) * 13} y2={Math.sin(hr) * 13} stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="0" y1="0" x2={Math.cos(mn) * 18} y2={Math.sin(mn) * 18} stroke="var(--coral)" strokeWidth="2" strokeLinecap="round" />
                    <circle cx="0" cy="0" r="2.5" fill="var(--ink)" />
                  </g>
                );
              })()}
              <g transform="translate(1130, 232)">
                <rect x="0" y="0" width="128" height="202" rx="4" fill="var(--desk-side-r)" stroke="var(--ink)" strokeWidth="2" />
                <line x1="64" y1="6" x2="64" y2="196" stroke="var(--ink)" strokeWidth="1.5" />
                <circle cx="52" cy="98" r="6" fill="var(--amber)" />
                <circle cx="76" cy="98" r="6" fill="var(--amber)" />
              </g>

              {/* Two ceiling fans */}
              {[490, 950].map((fx) => (
                <g key={fx} transform={`translate(${fx}, 115)`}>
                  <line x1="0" y1="-115" x2="0" y2="0" stroke="var(--ink)" strokeWidth="3" />
                  <ellipse cx="0" cy="0" rx="85" ry="11" fill="var(--ink)" opacity="0.22" />
                  <ellipse cx="0" cy="0" rx="16" ry="6" fill="var(--amber)" stroke="var(--ink)" strokeWidth="1.5" />
                </g>
              ))}

              {/* The tiled floor in perspective */}
              <polygon points="-400,720 110,440 1330,440 1840,720" fill="url(#pov-floor)" />
              {[468, 502, 544, 594, 654, 720].map((fy) => (
                <line key={fy} x1={-400} y1={fy} x2={1840} y2={fy} stroke="var(--grid)" strokeWidth="1.5" />
              ))}
              {[-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((col) => (
                <line key={col} x1={110 + (col / 10) * 1220} y1={440} x2={-320 + (col / 10) * 2080} y2={720} stroke="var(--grid)" strokeWidth="1.5" />
              ))}

              {/* The agents at their desks, the far ones first */}
              {agents
                .slice()
                .sort((a, b) => posOf(a.id).gx + posOf(a.id).gy - (posOf(b.id).gx + posOf(b.id).gy))
                .map((ag) => {
                  const { px, py, scale } = povPlace(ag.id);
                  const isSelected = selectedAgent === ag.id;
                  const said = ag.line ? lineText(ag.line.text, w.cannotVerify, 28) : null;
                  return (
                    <g key={ag.id} transform={`translate(${px.toFixed(1)}, ${py.toFixed(1)}) scale(${scale.toFixed(2)})`}>
                      <ellipse cx="0" cy="18" rx="48" ry="12" fill="var(--shadow)" />
                      <rect
                        x="-42"
                        y="-6"
                        width="84"
                        height="24"
                        rx="4"
                        fill="var(--desk-side-l)"
                        stroke={ag.id === "munshi" ? "var(--coral)" : "var(--edge)"}
                        strokeWidth={ag.id === "munshi" ? 2.5 : 1.2}
                      />
                      <polygon points="-46,-6 46,-6 38,-16 -38,-16" fill="var(--desk-top)" stroke="var(--edge)" strokeWidth="1" />
                      <g transform="translate(-32, -56)">
                        <AgentCharacter id={ag.id} state={ag.state} size={64} waitingCount={ag.waitingCount} agentStyle={agentStyle} />
                      </g>
                      <rect x="-32" y="2" width="64" height="15" rx="4" fill={isSelected ? "var(--coral)" : "var(--card)"} stroke="var(--ink)" strokeWidth="1" />
                      <text x="0" y="12.5" textAnchor="middle" fill={isSelected ? "#FFFDF9" : "var(--ink)"} fontSize="9.5" fontWeight="700">
                        {ag.name}
                      </text>
                      {said && (
                        <g transform="translate(0, -68)">
                          <rect x="-78" y="-32" width="156" height={ag.line?.source ? 36 : 24} rx="7" fill="var(--card)" stroke="var(--coral)" strokeWidth="1.4" />
                          <text x="0" y="-17" textAnchor="middle" fill="var(--ink)" fontSize="9.5" fontWeight="700">
                            {said}
                          </text>
                          {ag.line?.source && (
                            <text x="0" y="-4" textAnchor="middle" fill="var(--amber)" fontFamily="var(--font-mono)" fontSize="8" fontWeight="600">
                              {`↳ ${ag.line.source.label}`}
                            </text>
                          )}
                        </g>
                      )}
                    </g>
                  );
                })}
            </g>

            {/* The owner's desk in front, with the tray, the bell and a glass of chai */}
            <polygon points="0,715 1440,715 1440,820 0,820" fill="var(--desk-side-r)" stroke="var(--ink)" strokeWidth="2" />
            <polygon points="140,665 1300,665 1440,725 0,725" fill="var(--desk-top)" stroke="var(--coral)" strokeWidth="2.5" />
            <g transform="translate(720, 695)">
              <polygon points="-130,-22 130,-22 155,18 -155,18" fill="var(--coral)" stroke="var(--coral-deep)" strokeWidth="2.5" />
              {Array.from({ length: Math.min(6, Math.max(0, trayCount)) }, (_, idx) => idx).map((idx) => (
                <g key={idx} transform={`translate(0, ${-idx * 5 - 4})`}>
                  <polygon points="-88,-12 88,-12 102,10 -102,10" fill="var(--card)" stroke="var(--edge)" strokeWidth="1.2" />
                  <line x1="-52" y1="-2" x2="42" y2="-2" stroke="var(--coral)" strokeWidth="2.2" />
                </g>
              ))}
              <rect x="-92" y="24" width="184" height="28" rx="14" fill="var(--ink)" />
              <text x="0" y="42" textAnchor="middle" fill="#FFFDF9" fontFamily="var(--font-mono)" fontSize="12.5" fontWeight="700">
                {trayLabel}
              </text>
            </g>
            <g transform="translate(310, 690)">
              <ellipse cx="0" cy="8" rx="26" ry="9" fill="var(--shadow)" />
              <path d="M -18 8 C -18 -14, 18 -14, 18 8 Z" fill="var(--amber)" stroke="var(--ink)" strokeWidth="1.5" />
              <circle cx="0" cy="-12" r="5" fill="var(--coral)" />
            </g>
            <g transform="translate(1120, 688)">
              <ellipse cx="0" cy="10" rx="22" ry="8" fill="var(--shadow)" />
              <rect x="-12" y="-16" width="24" height="26" rx="4" fill="var(--card)" stroke="var(--edge)" strokeWidth="1.5" />
              <ellipse cx="0" cy="-16" rx="11" ry="4" fill="var(--amber)" />
            </g>
          </svg>

          {/* The view's buttons, laid over what they name: the brief board, each agent at its desk, the tray */}
          <div className="munshi-overlay">
            <button
              type="button"
              className="munshi-hit-btn"
              onClick={onOpenBrief}
              aria-label={briefAria}
              title={briefAria}
              style={{ left: `${((355 + povYaw * 0.45) / SVG_W) * 100}%`, top: `${(238 / SVG_H) * 100}%`, width: `${(165 / SVG_W) * 100}%`, height: `${(112 / SVG_H) * 100}%` }}
            />
            {agents.map((agent) => {
              const { px, py, scale } = povPlace(agent.id);
              return (
                <button
                  key={agent.id}
                  type="button"
                  className="munshi-hit-btn"
                  onClick={() => handleAgentClick(agent.id)}
                  aria-label={agentLabel(agent)}
                  style={{
                    left: `${((px + povYaw * 0.45 - 46 * scale) / SVG_W) * 100}%`,
                    top: `${((py - 60 * scale) / SVG_H) * 100}%`,
                    width: `${((92 * scale) / SVG_W) * 100}%`,
                    height: `${((80 * scale) / SVG_H) * 100}%`,
                  }}
                />
              );
            })}
            <button
              type="button"
              className="munshi-hit-btn"
              onClick={onOpenTray}
              aria-label={trayAria}
              title={trayAria}
              style={{ left: `${(565 / SVG_W) * 100}%`, top: `${(673 / SVG_H) * 100}%`, width: `${(310 / SVG_W) * 100}%`, height: `${(76 / SVG_H) * 100}%` }}
            />
          </div>
          </>
        ) : (
          <div className="munshi-camera" style={{ transform: cameraTransform }}>
            <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-label={w.room3d}>
              <defs>
                <radialGradient id="floor-warmth" cx="48%" cy="46%" r="55%">
                  <stop offset="0%" stopColor="var(--amber-wash)" stopOpacity="0.38" />
                  <stop offset="65%" stopColor="var(--floor)" stopOpacity="0.08" />
                  <stop offset="100%" stopColor="var(--floor)" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="lamp-halo" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="var(--coral)" stopOpacity="0.34" />
                  <stop offset="55%" stopColor="var(--amber)" stopOpacity="0.14" />
                  <stop offset="100%" stopColor="var(--amber)" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="window-godray" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="var(--teal-wash)" stopOpacity="0.52" />
                  <stop offset="60%" stopColor="var(--teal-wash)" stopOpacity="0.16" />
                  <stop offset="100%" stopColor="var(--teal-wash)" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* 1. Walls running to the frame's edges, and the floor filling the rest */}
              <polygon
                points={pts(farLeftWallEnd, topCorner, { x: topCorner.x, y: topCorner.y - WALL_H }, { x: farLeftWallEnd.x, y: farLeftWallEnd.y - WALL_H })}
                fill="var(--wall-l)"
                stroke="var(--edge)"
                strokeWidth="1.5"
              />
              <polygon
                points={pts(topCorner, farRightWallEnd, { x: farRightWallEnd.x, y: farRightWallEnd.y - WALL_H }, { x: topCorner.x, y: topCorner.y - WALL_H })}
                fill="var(--wall-r)"
                stroke="var(--edge)"
                strokeWidth="1.5"
              />
              <polygon points={pts(topCorner, farRightWallEnd, farBottomCorner, farLeftWallEnd)} fill="var(--floor)" />
              <polygon points={pts(topCorner, rightCorner, bottomCorner, leftCorner)} fill="url(#floor-warmth)" />
              <g stroke="var(--grid)" strokeWidth="1">
                {Array.from({ length: 16 }, (_, i) => i + 1).map((idx) => {
                  const a1 = isoToScreen(idx, 0);
                  const a2 = isoToScreen(idx, 16);
                  const b1 = isoToScreen(0, idx);
                  const b2 = isoToScreen(16, idx);
                  return (
                    <Fragment key={idx}>
                      <line x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y} />
                      <line x1={b1.x} y1={b1.y} x2={b2.x} y2={b2.y} />
                    </Fragment>
                  );
                })}
              </g>

              {/* The rug under the lead's desk: a rangoli in the haveli and the bazaar, a pool of green in the salon,
                  a dhurrie elsewhere */}
              {(() => {
                const c = isoToScreen(4.5, 4.5);
                if (environmentPreset === "haveli" || environmentPreset === "bazaar") {
                  return (
                    <g transform={`translate(${c.x}, ${c.y})`} opacity="0.82">
                      <ellipse cx="0" cy="0" rx="115" ry="58" fill="none" stroke="var(--coral)" strokeWidth="1.8" strokeDasharray="7 4" />
                      <ellipse cx="0" cy="0" rx="96" ry="48" fill="var(--amber-wash)" opacity="0.58" />
                      <polygon points="0,-42 84,0 0,42 -84,0" fill="none" stroke="var(--coral)" strokeWidth="1.4" />
                    </g>
                  );
                }
                if (environmentPreset === "salon") {
                  return (
                    <g transform={`translate(${c.x}, ${c.y})`} opacity="0.76">
                      <ellipse cx="0" cy="0" rx="112" ry="56" fill="var(--teal-wash)" stroke="var(--teal)" strokeWidth="1.4" />
                      <ellipse cx="18" cy="-8" rx="72" ry="36" fill="var(--amber-wash)" opacity="0.65" />
                    </g>
                  );
                }
                return (
                  <polygon
                    points={pts(isoToScreen(2.8, 2.8), isoToScreen(6.2, 2.8), isoToScreen(6.2, 6.2), isoToScreen(2.8, 6.2))}
                    fill="var(--amber-wash)"
                    stroke="var(--coral)"
                    strokeWidth="1.4"
                    opacity="0.52"
                  />
                );
              })()}

              {/* 2. The dado rail and the crown moulding along both walls */}
              {(() => {
                const wl1 = isoToScreen(0, 16, 38);
                const wc = isoToScreen(0, 0, 38);
                const wr1 = isoToScreen(16, 0, 38);
                const topL = isoToScreen(0, 16, 145);
                const topC = isoToScreen(0, 0, 145);
                const topR = isoToScreen(16, 0, 145);
                return (
                  <g opacity="0.65">
                    <line x1={wl1.x} y1={wl1.y} x2={wc.x} y2={wc.y} stroke="var(--edge)" strokeWidth="2.5" />
                    <line x1={wc.x} y1={wc.y} x2={wr1.x} y2={wr1.y} stroke="var(--edge)" strokeWidth="2.5" />
                    <line x1={topL.x} y1={topL.y} x2={topC.x} y2={topC.y} stroke="var(--slab-r)" strokeWidth="4" />
                    <line x1={topC.x} y1={topC.y} x2={topR.x} y2={topR.y} stroke="var(--slab-r)" strokeWidth="4" />
                  </g>
                );
              })()}

              {/* Each room's mark on its walls: a marigold toran in the kirana and the bazaar, brass bosses in the
                  haveli, vines in the salon */}
              {(environmentPreset === "kirana" || environmentPreset === "bazaar") && (
                <g>
                  {[0.9, 1.8, 2.7, 3.6, 4.5, 5.4, 6.3, 7.2, 8.1, 9.0].map((step, i) => {
                    const pL = isoToScreen(0, step, 136 - (i % 2) * 6);
                    const pR = isoToScreen(step, 0, 136 - (i % 2) * 6);
                    return (
                      <Fragment key={step}>
                        <circle cx={pL.x} cy={pL.y} r="4.2" fill={i % 2 === 0 ? "var(--coral)" : "var(--amber)"} />
                        <circle cx={pR.x} cy={pR.y} r="4.2" fill={i % 2 === 0 ? "var(--amber)" : "var(--coral)"} />
                      </Fragment>
                    );
                  })}
                </g>
              )}
              {environmentPreset === "haveli" && (
                <g opacity="0.65">
                  {[1.5, 3.2, 5.0, 6.8, 8.5].map((pos) => {
                    const aL = isoToScreen(0, pos, 134);
                    const aR = isoToScreen(pos, 0, 134);
                    return (
                      <Fragment key={pos}>
                        <circle cx={aL.x} cy={aL.y} r="5.5" fill="var(--coral)" />
                        <circle cx={aR.x} cy={aR.y} r="5.5" fill="var(--coral)" />
                      </Fragment>
                    );
                  })}
                </g>
              )}
              {environmentPreset === "salon" && (
                <g>
                  {[1.2, 3.2, 6.5, 8.4].map((gy) => {
                    const vp = isoToScreen(0, gy, 140);
                    return (
                      <g key={gy} transform={`translate(${vp.x}, ${vp.y})`}>
                        <line x1="0" y1="0" x2="0" y2="28" stroke="var(--ok)" strokeWidth="1.8" />
                        <circle cx="-3.5" cy="12" r="3.5" fill="var(--ok)" />
                        <circle cx="3.5" cy="21" r="3.8" fill="var(--teal)" />
                      </g>
                    );
                  })}
                </g>
              )}

              {/* Left wall: the shelf of ledgers and the morning brief board */}
              {(() => {
                const s1 = isoToScreen(0, 1.1, 56);
                const s2 = isoToScreen(0, 2.7, 56);
                const b1 = isoToScreen(0, 3.8, 86);
                const b2 = isoToScreen(0, 5.9, 86);
                const b3 = isoToScreen(0, 5.9, 32);
                const b4 = isoToScreen(0, 3.8, 32);
                const t1 = isoToScreen(0, 4.1, 74);
                const t2 = isoToScreen(0, 5.5, 74);
                const colors = ["var(--coral)", "var(--teal)", "var(--ink)", "var(--amber)", "var(--coral-deep)"];
                return (
                  <g>
                    <polygon points={`${s1.x},${s1.y} ${s2.x},${s2.y} ${s2.x + 12},${s2.y + 6} ${s1.x + 12},${s1.y + 6}`} fill="var(--slab-r)" />
                    {[0.2, 0.5, 0.8, 1.1, 1.35].map((offset, idx) => {
                      const bp = isoToScreen(0.08, 1.2 + offset, 58);
                      return <polygon key={offset} points={`${bp.x},${bp.y} ${bp.x + 8},${bp.y + 4} ${bp.x + 8},${bp.y - 16} ${bp.x},${bp.y - 20}`} fill={colors[idx % colors.length]} />;
                    })}
                    <polygon points={pts(b1, b2, b3, b4)} fill="var(--card)" stroke="var(--coral)" strokeWidth="1.8" />
                    <circle cx={(b1.x + b2.x) / 2} cy={(b1.y + b2.y) / 2 + 2} r="3.5" fill="var(--coral)" />
                    <line x1={t1.x} y1={t1.y} x2={t2.x} y2={t2.y} stroke="var(--coral)" strokeWidth="3" strokeLinecap="round" />
                    {[64, 55, 46, 38].map((z, i) => {
                      const l1 = isoToScreen(0, 4.1, z);
                      const l2 = isoToScreen(0, i === 3 ? 5.1 : 5.6, z);
                      return <line key={z} x1={l1.x} y1={l1.y} x2={l2.x} y2={l2.y} stroke="var(--slab-r)" strokeWidth="2.2" strokeLinecap="round" />;
                    })}
                  </g>
                );
              })()}

              {/* Left wall: the carved shop door with its brass bell */}
              {(() => {
                const d1 = isoToScreen(0, 7.3, 108);
                const d2 = isoToScreen(0, 8.9, 108);
                const d3 = isoToScreen(0, 8.9, 0);
                const d4 = isoToScreen(0, 7.3, 0);
                const bell = isoToScreen(0, 8.1, 96);
                return (
                  <g>
                    <polygon points={pts(d1, d2, d3, d4)} fill="var(--slab-r)" stroke="var(--ink)" strokeWidth="2" />
                    <polygon points={`${d1.x + 6},${d1.y + 8} ${d2.x - 4},${d2.y + 4} ${d3.x - 4},${d3.y} ${d4.x + 6},${d4.y}`} fill="var(--teal-wash)" opacity="0.55" />
                    <line x1={bell.x} y1={bell.y - 10} x2={bell.x} y2={bell.y} stroke="var(--amber)" strokeWidth="1.5" />
                    <circle cx={bell.x} cy={bell.y + 3} r="4.2" fill="var(--amber)" />
                  </g>
                );
              })()}

              {/* The framed shop deed by the corner, and a second window along the right wall */}
              {(() => {
                const f1 = isoToScreen(0, 0.35, 112);
                const f2 = isoToScreen(0, 0.95, 112);
                const f3 = isoToScreen(0, 0.95, 76);
                const f4 = isoToScreen(0, 0.35, 76);
                const w2a = isoToScreen(8.4, 0, 104);
                const w2b = isoToScreen(10.8, 0, 104);
                const w2c = isoToScreen(10.8, 0, 38);
                const w2d = isoToScreen(8.4, 0, 38);
                return (
                  <g>
                    <polygon points={pts(f1, f2, f3, f4)} fill="var(--card)" stroke="var(--amber)" strokeWidth="2" />
                    <polygon points={pts(w2a, w2b, w2c, w2d)} fill="var(--teal-wash)" opacity={timeInfo.windowOpacity} stroke="var(--ink)" strokeWidth="2.2" />
                    <line x1={(w2a.x + w2b.x) / 2} y1={(w2a.y + w2b.y) / 2} x2={(w2d.x + w2c.x) / 2} y2={(w2d.y + w2c.y) / 2} stroke="var(--ink)" strokeWidth="1.6" />
                  </g>
                );
              })()}

              {/* Timber rafters overhead with two hanging brass lanterns */}
              {(() => {
                const b1s = isoToScreen(0, 2.5, 145);
                const b1e = isoToScreen(6.5, 2.5, 145);
                const b2s = isoToScreen(0, 6.0, 145);
                const b2e = isoToScreen(6.5, 6.0, 145);
                return (
                  <g opacity="0.72">
                    <line x1={b1s.x} y1={b1s.y} x2={b1e.x} y2={b1e.y} stroke="var(--slab-r)" strokeWidth="4" strokeLinecap="round" />
                    <line x1={b2s.x} y1={b2s.y} x2={b2e.x} y2={b2e.y} stroke="var(--slab-r)" strokeWidth="4" strokeLinecap="round" />
                    {[isoToScreen(3.2, 2.5, 127), isoToScreen(3.2, 6.0, 127)].map((l) => (
                      <g key={`${l.x},${l.y}`}>
                        <line x1={l.x} y1={l.y - 18} x2={l.x} y2={l.y} stroke="var(--ink)" strokeWidth="1.4" />
                        <polygon points={`${l.x - 7},${l.y} ${l.x + 7},${l.y} ${l.x + 10},${l.y + 8} ${l.x - 10},${l.y + 8}`} fill="var(--amber)" />
                        <circle cx={l.x} cy={l.y + 10} r="4" fill="var(--coral)" opacity="0.85" />
                      </g>
                    ))}
                  </g>
                );
              })()}

              {/* Right wall: the long window, its light on the floor, the neem outside (in the monsoon, rain), and the clock */}
              {(() => {
                const w1 = isoToScreen(2.2, 0, 104);
                const w2 = isoToScreen(6.0, 0, 104);
                const w3 = isoToScreen(6.0, 0, 38);
                const w4 = isoToScreen(2.2, 0, 38);
                const tree = isoToScreen(3.6, 0, 62);
                const clock = isoToScreen(7.4, 0, 82);
                const hr = ((((timeInfo.hours % 12) + timeInfo.minutes / 60) * 30 - 90) * Math.PI) / 180;
                const mn = ((timeInfo.minutes * 6 - 90) * Math.PI) / 180;
                return (
                  <g>
                    <polygon
                      points={pts(isoToScreen(2.2, 0), isoToScreen(6.0, 0), isoToScreen(6.0, 4.2), isoToScreen(2.2, 4.2))}
                      fill="url(#window-godray)"
                      opacity={timeInfo.beamOpacity * 2.2}
                    />
                    <polygon points={pts(w1, w2, w3, w4)} fill="var(--teal-wash)" opacity={timeInfo.windowOpacity} stroke="var(--ink)" strokeWidth="2.2" />
                    <circle cx={tree.x - 16} cy={tree.y - 6} r="14" fill="var(--ok)" opacity="0.26" />
                    <circle cx={tree.x + 8} cy={tree.y - 12} r="18" fill="var(--teal)" opacity="0.22" />
                    <circle cx={tree.x + 28} cy={tree.y + 2} r="13" fill="var(--ok)" opacity="0.24" />
                    {environmentPreset === "monsoon" && (
                      <g stroke="var(--teal)" strokeWidth="1.2" opacity="0.6">
                        {[24, 62, 104, 146, 180].map((dx, i) => (
                          <line
                            key={dx}
                            x1={w1.x + dx}
                            y1={w1.y + 10 + dx * 0.3}
                            x2={w1.x + dx - 12}
                            y2={w1.y + 36 + dx * 0.3}
                            className="munshi-rain"
                            style={{ animationDelay: `${i * 0.25}s` }}
                          />
                        ))}
                      </g>
                    )}
                    <line x1={(w1.x * 2 + w2.x) / 3} y1={(w1.y * 2 + w2.y) / 3} x2={(w4.x * 2 + w3.x) / 3} y2={(w4.y * 2 + w3.y) / 3} stroke="var(--ink)" strokeWidth="1.6" />
                    <line x1={(w1.x + w2.x * 2) / 3} y1={(w1.y + w2.y * 2) / 3} x2={(w4.x + w3.x * 2) / 3} y2={(w4.y + w3.y * 2) / 3} stroke="var(--ink)" strokeWidth="1.6" />
                    <g transform={`translate(${clock.x}, ${clock.y})`}>
                      <ellipse cx="0" cy="0" rx="16" ry="18" fill="var(--card)" stroke="var(--ink)" strokeWidth="1.8" />
                      <line x1="0" y1="0" x2={Math.cos(hr) * 7.5} y2={Math.sin(hr) * 7.5} stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
                      <line x1="0" y1="0" x2={Math.cos(mn) * 11} y2={Math.sin(mn) * 11} stroke="var(--coral)" strokeWidth="1.5" strokeLinecap="round" />
                      <circle cx="0" cy="0" r="1.8" fill="var(--ink)" />
                    </g>
                  </g>
                );
              })()}

              {/* 3. Furniture and agents, the farther drawn first */}
              {sortedSceneItems.map((item) => {
                const p = isoToScreen(item.gx, item.gy);
                if (item.kind === "plant") {
                  return (
                    <g key={item.id} transform={`translate(${p.x}, ${p.y})`}>
                      <ellipse cx="0" cy="3" rx="15" ry="7.5" fill="var(--shadow)" />
                      <path d="M -10 -12 L 10 -12 L 7 3 L -7 3 Z" fill="var(--coral-deep)" />
                      <ellipse cx="-7" cy="-20" rx="6" ry="11" transform="rotate(-24 -7 -20)" fill="var(--ok)" />
                      <ellipse cx="7" cy="-21" rx="6" ry="11" transform="rotate(22 7 -21)" fill="var(--teal)" />
                      <ellipse cx="0" cy="-25" rx="5.5" ry="12" fill="var(--ok)" />
                    </g>
                  );
                }
                if (item.kind === "vault") {
                  return (
                    <g key="archive-credenza" transform={`translate(${p.x}, ${p.y})`}>
                      <ellipse cx="0" cy="5" rx="28" ry="14" fill="var(--shadow)" />
                      <polygon points="-22,-18 0,-7 0,8 -22,-3" fill="var(--desk-side-l)" />
                      <polygon points="0,-7 22,-18 22,-3 0,8" fill="var(--desk-side-r)" />
                      <polygon points="0,-29 22,-18 0,-7 -22,-18" fill="var(--desk-top)" stroke="var(--edge)" strokeWidth="1" />
                      <circle cx="-10" cy="-5" r="3.5" fill="var(--amber)" />
                      <circle cx="0" cy="-19" r="3" fill="var(--coral)" />
                    </g>
                  );
                }
                if (item.kind === "lounge") {
                  return (
                    <g key="chai-lounge" transform={`translate(${p.x}, ${p.y})`}>
                      <ellipse cx="0" cy="6" rx="36" ry="18" fill="var(--shadow)" />
                      <ellipse cx="0" cy="3" rx="44" ry="22" fill="var(--teal-wash)" opacity="0.6" />
                      <polygon points="-24,-6 0,6 0,13 -24,1" fill="var(--desk-side-l)" />
                      <polygon points="0,6 24,-6 24,1 0,13" fill="var(--desk-side-r)" />
                      <polygon points="0,-18 24,-6 0,6 -24,-6" fill="var(--desk-top)" stroke="var(--edge)" strokeWidth="1.1" />
                      <circle cx="-4" cy="-9" r="4.5" fill="var(--amber)" />
                      <ellipse cx="-26" cy="10" rx="11" ry="5.5" fill="var(--coral)" opacity="0.85" />
                      <ellipse cx="26" cy="10" rx="11" ry="5.5" fill="var(--amber)" opacity="0.85" />
                    </g>
                  );
                }
                if (item.kind === "shelf") {
                  return (
                    <g key="stock-shelf" transform={`translate(${p.x}, ${p.y})`}>
                      <ellipse cx="0" cy="5" rx="28" ry="14" fill="var(--shadow)" />
                      <line x1="-18" y1="0" x2="-18" y2="-48" stroke="var(--ink)" strokeWidth="2.4" />
                      <line x1="18" y1="0" x2="18" y2="-48" stroke="var(--ink)" strokeWidth="2.4" />
                      {[-10, -26, -42].map((y, idx) => (
                        <g key={y}>
                          <polygon points={`0,${y - 8} 23,${y} 0,${y + 8} -23,${y}`} fill="var(--desk-top)" stroke="var(--edge)" strokeWidth="1.2" />
                          <rect x="-11" y={y - 6} width="8.5" height="7" rx="1.2" fill={idx === 1 ? "var(--coral)" : "var(--slab-r)"} />
                          <rect x="2" y={y - 5} width="7.5" height="6" rx="1.2" fill="var(--teal)" opacity="0.8" />
                        </g>
                      ))}
                    </g>
                  );
                }
                if (item.kind === "desk") {
                  const working = item.agent && (item.agent.state === "thinking" || item.agent.state === "drafting" || item.agent.state === "watching");
                  if (item.agentId === "munshi") {
                    return (
                      <g key="desk-munshi" transform={`translate(${p.x}, ${p.y})`}>
                        <ellipse cx="0" cy="8" rx="48" ry="24" fill="var(--shadow)" />
                        {working && <ellipse cx="0" cy="2" rx="56" ry="28" fill="url(#lamp-halo)" />}
                        <path d="M -42 -14 L -42 2 A 42 21 0 0 0 42 2 L 42 -14 Z" fill="var(--desk-side-l)" />
                        <ellipse cx="0" cy="-14" rx="42" ry="21" fill="var(--desk-top)" stroke="var(--coral)" strokeWidth="3.2" />
                        <g transform="translate(-10, -25)">
                          <rect x="-10" y="-13" width="20" height="13" rx="2.5" fill="var(--ink)" />
                          {working && <rect x="-8" y="-11" width="16" height="9" rx="1.5" fill="var(--coral)" opacity="0.65" />}
                          <rect x="-2.5" y="0" width="5" height="3.5" fill="var(--ink)" />
                        </g>
                        <g transform="translate(17, -16)">
                          <rect x="-4" y="-6" width="8" height="7" rx="2" fill="var(--card)" stroke="var(--edge)" strokeWidth="1" />
                          <ellipse cx="0" cy="-6" rx="3.5" ry="1.5" fill="var(--amber)" />
                          <path d="M -1 -9 Q -3 -14 0 -17" fill="none" stroke="var(--ink-muted)" strokeWidth="1.2" strokeLinecap="round" className="munshi-steam" />
                        </g>
                      </g>
                    );
                  }
                  return (
                    <g key={`desk-${item.agentId}`} transform={`translate(${p.x}, ${p.y})`}>
                      <ellipse cx="0" cy="7" rx="34" ry="17" fill="var(--shadow)" />
                      {working && <ellipse cx="0" cy="0" rx="40" ry="20" fill="url(#lamp-halo)" />}
                      <rect x="-28" y="-2" width="4" height="14" fill="var(--ink)" opacity="0.7" />
                      <rect x="24" y="-2" width="4" height="14" fill="var(--ink)" opacity="0.7" />
                      <polygon points="-32,-12 0,4 0,16 -32,0" fill="var(--desk-side-l)" />
                      <polygon points="0,4 32,-12 32,0 0,16" fill="var(--desk-side-r)" />
                      <polygon points="0,-28 32,-12 0,4 -32,-12" fill="var(--desk-top)" stroke="var(--edge)" strokeWidth="1.2" />
                      {/* An open red bahi-khata and a banker's lamp */}
                      <polygon points="6,-13 18,-7 11,-3 -1,-9" fill="var(--coral-deep)" />
                      <polygon points="7,-12.5 17,-7.5 11,-4 1,-9" fill="var(--card)" />
                      <line x1="16" y1="-12" x2="16" y2="-21" stroke="var(--amber)" strokeWidth="1.6" />
                      <polygon points="11,-21 21,-21 23,-17 9,-17" fill="var(--teal)" />
                      <g transform="translate(-6, -18)">
                        <rect x="-9" y="-13" width="18" height="12.5" rx="2.2" fill="var(--ink)" />
                        {working && <rect x="-7.2" y="-11.2" width="14.4" height="9" rx="1.2" fill="var(--coral)" opacity="0.65" />}
                        <rect x="-2.2" y="-0.5" width="4.4" height="3.5" fill="var(--ink)" />
                      </g>
                    </g>
                  );
                }
                if (item.kind === "tray") {
                  return (
                    <g key="owners-tray" transform={`translate(${p.x}, ${p.y})`}>
                      <ellipse cx="0" cy="10" rx="46" ry="23" fill="var(--shadow)" />
                      <ellipse cx="0" cy="4" rx="54" ry="27" fill="url(#lamp-halo)" />
                      <polygon points="-38,-10 0,9 0,20 -38,1" fill="var(--desk-side-l)" />
                      <polygon points="0,9 38,-10 38,1 0,20" fill="var(--desk-side-r)" />
                      <polygon points="0,-29 38,-10 0,9 -38,-10" fill="var(--desk-top)" stroke="var(--coral)" strokeWidth="1.6" />
                      <polygon points="0,-25 26,-12 0,1 -26,-12" fill="var(--coral)" stroke="var(--coral-deep)" strokeWidth="1.8" />
                      {Array.from({ length: Math.min(6, Math.max(0, trayCount)) }, (_, idx) => idx).map((idx) => (
                        <g key={idx} transform={`translate(0, ${-idx * 3.6})`}>
                          <polygon points="0,-22 18,-13 0,-4 -18,-13" fill="var(--card)" stroke="var(--edge)" strokeWidth="1.1" />
                          <line x1="-6" y1="-13.5" x2="5" y2="-13.5" stroke="var(--coral)" strokeWidth="1.6" strokeLinecap="round" />
                        </g>
                      ))}
                      <g transform="translate(0, 33)">
                        <rect x="-66" y="-13" width="132" height="26" rx="13" fill="var(--coral)" />
                        <text x="0" y="4" textAnchor="middle" fill="#FFFDF9" fontFamily="var(--font-mono)" fontSize="12" fontWeight="700" letterSpacing="0.05em">
                          {trayLabel}
                        </text>
                      </g>
                    </g>
                  );
                }
                if (item.kind !== "agent") return null;
                const { agent } = item;
                const isSelected = selectedAgent === agent.id || (view === "pov_agent" && followed === agent.id);
                const keeperClosing = activeFxList.some((fx) => fx.kind === "memory" && fx.agent === agent.id);
                return (
                  <g key={`agent-${agent.id}`} transform={`translate(${p.x}, ${p.y})`}>
                    {agent.state === "watching" && (
                      <ellipse cx="0" cy="3" rx="24" ry="12" fill="var(--teal-wash)" stroke="var(--teal)" strokeWidth="1.6" className="munshi-watch-ring" />
                    )}
                    {isSelected && <ellipse cx="0" cy="3" rx="26" ry="13" fill="none" stroke="var(--coral)" strokeWidth="2.5" />}
                    <ellipse cx="0" cy="3" rx="15" ry="7.5" fill="var(--shadow)" />
                    <g transform="translate(-29, -46)">
                      <AgentCharacter id={agent.id} state={agent.state} size={58} waitingCount={agent.waitingCount} closingSlots={keeperClosing} agentStyle={agentStyle} />
                    </g>
                    <g transform="translate(0, 15)">
                      <rect x="-28" y="-7.5" width="56" height="15" rx="7.5" fill="var(--card)" stroke={isSelected ? "var(--coral)" : "var(--edge)"} strokeWidth="1.1" />
                      <text x="0" y="3" textAnchor="middle" fill="var(--ink)" fontSize="10" fontWeight="700">
                        {agent.name}
                      </text>
                    </g>
                  </g>
                );
              })}

              {/* 4. What an event does, played once: an approved draft flies to the ledgers, a message comes in by the
                  window to Echo, a note slides into Keeper */}
              {activeFxList.map((fx) => {
                const t = Math.min(1, Math.max(0, (performance.now() - fx.startTime) / fx.durationMs));
                if (fx.kind === "approved") {
                  const start = isoToScreen(SPECIAL_SPOTS.trayTable.gx, SPECIAL_SPOTS.trayTable.gy, 14);
                  const end = isoToScreen(0.1, 1.8, 56);
                  const cx = start.x + (end.x - start.x) * t;
                  const cy = start.y + (end.y - start.y) * t - Math.sin(t * Math.PI) * 56;
                  return (
                    <g key={fx.eventId}>
                      <g transform={`translate(${cx}, ${cy}) rotate(${t * -25})`}>
                        <rect x="-10" y="-13" width="20" height="24" rx="2.5" fill="var(--card)" stroke="var(--ok)" strokeWidth="1.8" />
                        <line x1="-5" y1="-5" x2="5" y2="-5" stroke="var(--ok)" strokeWidth="1.6" />
                      </g>
                      <g transform={`translate(${start.x}, ${start.y - 44})`} opacity={t < 0.75 ? 1 : Math.max(0, 1 - (t - 0.75) * 4)}>
                        <rect x="-46" y="-12" width="92" height="24" rx="6" fill="var(--card)" stroke="var(--ok)" strokeWidth="2" />
                        <text x="0" y="4" textAnchor="middle" fill="var(--ok)" fontFamily="var(--font-mono)" fontSize="11.5" fontWeight="700">
                          {w.approved}
                        </text>
                      </g>
                    </g>
                  );
                }
                if (fx.kind === "message") {
                  const win = isoToScreen(4.1, 0, 68);
                  const echo = isoToScreen(posOf("echo").gx, posOf("echo").gy, 24);
                  const cx = win.x + (echo.x - win.x) * t;
                  const cy = win.y + (echo.y - win.y) * t - Math.sin(t * Math.PI) * 24;
                  return (
                    <g key={fx.eventId} transform={`translate(${cx}, ${cy})`}>
                      <rect x="-11" y="-7.5" width="22" height="15" rx="2.5" fill="var(--card)" stroke="var(--teal)" strokeWidth="1.6" />
                      <polyline points="-10,-6.5 0,1.5 10,-6.5" fill="none" stroke="var(--coral)" strokeWidth="1.5" />
                    </g>
                  );
                }
                if (fx.kind === "memory") {
                  const kp = isoToScreen(posOf("keeper").gx, posOf("keeper").gy, 22);
                  return (
                    <g key={fx.eventId} transform={`translate(${kp.x - 28 * (1 - t)}, ${kp.y})`} opacity={1 - t * 0.85}>
                      <rect x="-8" y="-5.5" width="16" height="11" rx="1.8" fill="var(--card)" stroke="var(--coral)" strokeWidth="1.4" />
                    </g>
                  );
                }
                return null;
              })}

              {/* 5. What each agent says, the host's own words with the row they come from */}
              {agents.map((agent) => {
                const thinkingDots = selectedAgent === agent.id && agent.state === "thinking" && !agent.line;
                if (!agent.line && !thinkingDots) return null;
                const p = isoToScreen(posOf(agent.id).gx, posOf(agent.id).gy);
                const text = agent.line ? lineText(agent.line.text, w.cannotVerify, 32) : "";
                const inspecting = hoveredAgent === agent.id || focusedAgent === agent.id || selectedAgent === agent.id;
                const source = agent.line?.source?.label;
                const width = Math.max(126, Math.min(234, Math.max(text.length, source ? source.length + 2 : 0) * 7.4 + 28));
                const height = source ? 46 : 28;
                const stroke = inspecting ? "var(--coral)" : "var(--ink)";
                return (
                  <g key={`bubble-${agent.id}`} transform={`translate(${p.x}, ${p.y - 62})`} style={{ pointerEvents: "none" }} data-line={agent.id}>
                    <rect x={-width / 2} y={-height} width={width} height={height} rx="9" fill="var(--card)" stroke={stroke} strokeWidth="1.4" />
                    <polygon points="-5,0 5,0 0,6" fill="var(--card)" stroke={stroke} strokeWidth="1.2" />
                    {thinkingDots ? (
                      <g transform="translate(0, -14)">
                        <circle cx="-7" cy="0" r="2.3" fill="var(--amber)" className="munshi-dot-1" />
                        <circle cx="0" cy="0" r="2.3" fill="var(--amber)" className="munshi-dot-2" />
                        <circle cx="7" cy="0" r="2.3" fill="var(--amber)" className="munshi-dot-3" />
                      </g>
                    ) : (
                      <>
                        <text x="0" y={source ? -27 : -10} textAnchor="middle" fill="var(--ink)" fontSize="11.5" fontWeight="600">
                          {text}
                        </text>
                        {source && (
                          <g transform="translate(0, -10)">
                            <rect x={-width / 2 + 6} y="-9.5" width={width - 12} height="15" rx="4" fill="var(--amber-wash)" />
                            <text x="0" y="1" textAnchor="middle" fill="var(--amber)" fontFamily="var(--font-mono)" fontSize="9.5" fontWeight="600">
                              {`↳ ${source}`}
                            </text>
                          </g>
                        )}
                      </>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* The room's buttons, laid over what they name: the brief board, each agent, the tray */}
            <div className="munshi-overlay">
              {(() => {
                const c = isoToScreen(0, 4.85, 59);
                return (
                  <button
                    type="button"
                    className="munshi-hit-btn"
                    onClick={onOpenBrief}
                    aria-label={briefAria}
                    title={briefAria}
                    style={{ left: `${(c.x / SVG_W) * 100 - 4.2}%`, top: `${(c.y / SVG_H) * 100 - 6}%`, width: "8.4%", height: "13%" }}
                  />
                );
              })()}
              {agents.map((agent) => {
                const screen = isoToScreen(posOf(agent.id).gx, posOf(agent.id).gy);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    className="munshi-hit-btn"
                    onClick={() => handleAgentClick(agent.id)}
                    onMouseEnter={() => setHoveredAgent(agent.id)}
                    onMouseLeave={() => setHoveredAgent((prev) => (prev === agent.id ? null : prev))}
                    onFocus={() => setFocusedAgent(agent.id)}
                    onBlur={() => setFocusedAgent((prev) => (prev === agent.id ? null : prev))}
                    aria-label={agentLabel(agent)}
                    style={{
                      left: `${(screen.x / SVG_W) * 100 - 3.4}%`,
                      top: `${((screen.y - 24) / SVG_H) * 100 - 5}%`,
                      width: "6.8%",
                      height: "10.5%",
                    }}
                  />
                );
              })}
              {(() => {
                const t = isoToScreen(SPECIAL_SPOTS.trayTable.gx, SPECIAL_SPOTS.trayTable.gy);
                return (
                  <button
                    type="button"
                    className="munshi-hit-btn"
                    onClick={onOpenTray}
                    aria-label={trayAria}
                    title={trayAria}
                    style={{ left: `${(t.x / SVG_W) * 100 - 6.5}%`, top: `${(t.y / SVG_H) * 100 - 5.5}%`, width: "13%", height: "12.5%" }}
                  />
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
