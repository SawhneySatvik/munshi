"use client";

// The isometric back office: the room, the desks, the tray and the agents walking between them, driven only by props
// (types.ts). Parts drawn as placeholders are marked [STAND-IN], and the characters are AgentBot's.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AgentBot } from "./AgentBot";
import type { Agent, AgentId, AgentState, GridCoord, OfficeEvent, OfficeProps } from "./types";
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
export type EnvironmentPresetId = "kirana" | "haveli" | "bazaar" | "salon" | "monsoon";
export type AgentStyleId = "clay" | "flat";

// [STAND-IN] Window light by the hour.
function parseTimeOfDay(iso: string) {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  const hours = m ? Number(m[1]) : 10, minutes = m ? Number(m[2]) : 30;
  const day = hours >= 7 && hours < 18;
  return { hours, minutes, windowOpacity: day ? 1 : 0.35, beamOpacity: day ? 0.5 : 0 };
}

export interface ScreenCoord {
  x: number;
  y: number;
}

const GRID_SIZE = 10;
const TILE_W = 104;
const TILE_H = 52;
const ORIGIN_X = 680;
const ORIGIN_Y = 148;

function isoToScreen(gx: number, gy: number, gz = 0): ScreenCoord {
  const x = ORIGIN_X + (gx - gy) * (TILE_W / 2);
  const y = ORIGIN_Y + (gx + gy) * (TILE_H / 2) - gz;
  return { x, y };
}

const DESK_CONFIG: Record<
  AgentId,
  {
    deskPos: GridCoord;
    standPos: GridCoord;
    peerPos: GridCoord;
    isLead?: boolean;
  }
> = {
  munshi: {
    deskPos: { gx: 4.5, gy: 4.5 },
    standPos: { gx: 4.5, gy: 5.45 },
    peerPos: { gx: 5.5, gy: 4.6 },
    isLead: true,
  },
  tally: {
    deskPos: { gx: 1.8, gy: 1.8 },
    standPos: { gx: 2.7, gy: 1.8 },
    peerPos: { gx: 2.9, gy: 2.3 },
  },
  ledger: {
    deskPos: { gx: 1.8, gy: 5.2 },
    standPos: { gx: 2.7, gy: 5.2 },
    peerPos: { gx: 2.9, gy: 5.5 },
  },
  dash: {
    deskPos: { gx: 4.5, gy: 7.0 },
    standPos: { gx: 5.4, gy: 7.0 },
    peerPos: { gx: 5.6, gy: 7.0 },
  },
  echo: {
    deskPos: { gx: 5.4, gy: 1.8 },
    standPos: { gx: 5.4, gy: 2.7 },
    peerPos: { gx: 5.4, gy: 2.9 },
  },
  bloom: {
    deskPos: { gx: 7.8, gy: 2.8 },
    standPos: { gx: 6.9, gy: 2.8 },
    peerPos: { gx: 6.7, gy: 3.1 },
  },
  keeper: {
    deskPos: { gx: 7.8, gy: 5.8 },
    standPos: { gx: 6.9, gy: 5.8 },
    peerPos: { gx: 6.7, gy: 5.8 },
  },
};

const SPECIAL_SPOTS: {
  trayTable: GridCoord;
  trayApproach: GridCoord;
  shelfFurniture: GridCoord;
  shelfStand: GridCoord;
  door: GridCoord;
  briefBoard: GridCoord;
  ledgerShelf: GridCoord;
  loungeTable: GridCoord;
  vaultCabinet: GridCoord;
} = {
  trayTable: { gx: 7.8, gy: 8.0 },
  trayApproach: { gx: 6.9, gy: 7.7 },
  shelfFurniture: { gx: 0.75, gy: 3.4 },
  shelfStand: { gx: 1.65, gy: 3.4 },
  door: { gx: 0.8, gy: 8.2 },
  briefBoard: { gx: 0.0, gy: 4.9 },
  ledgerShelf: { gx: 0.0, gy: 1.8 },
  loungeTable: { gx: 2.0, gy: 8.1 },
  vaultCabinet: { gx: 8.4, gy: 1.1 },
};

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
  if (forWaiting) {
    return TRAY_WAITING_SLOTS[agentId] || SPECIAL_SPOTS.trayApproach;
  }
  switch (spot) {
    case 'desk':
      return DESK_CONFIG[agentId].standPos;
    case 'lead':
      return agentId === 'munshi' ? DESK_CONFIG.munshi.standPos : DESK_CONFIG.munshi.peerPos;
    case 'tray':
      return TRAY_WAITING_SLOTS[agentId] || SPECIAL_SPOTS.trayApproach;
    case 'shelf':
      return SPECIAL_SPOTS.shelfStand;
    case 'door':
      return SPECIAL_SPOTS.door;
    default:
      return DESK_CONFIG[spot]?.peerPos ?? DESK_CONFIG[agentId].standPos;
  }
}

function getRestingCoord(agent: Agent): GridCoord {
  if (agent.state === 'waiting') {
    return resolveTargetCoord(agent.id, 'tray', true);
  }
  return DESK_CONFIG[agent.id].standPos;
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
  for (const b of OBSTACLE_BOXES) {
    if (gx >= b.minX && gx <= b.maxX && gy >= b.minY && gy <= b.maxY) {
      return true;
    }
  }
  return false;
}

function computeGridPath(start: GridCoord, goal: GridCoord): GridCoord[] {
  const snap = (v: number) => Math.round(v * 2) / 2;
  const s: GridCoord = { gx: snap(start.gx), gy: snap(start.gy) };
  const g: GridCoord = { gx: snap(goal.gx), gy: snap(goal.gy) };

  if (Math.hypot(s.gx - g.gx, s.gy - g.gy) < 0.25) {
    return [goal];
  }

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
    const current = open.shift()!;
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
      const next: GridCoord = {
        gx: Math.round((current.gx + d.dx) * 2) / 2,
        gy: Math.round((current.gy + d.dy) * 2) / 2,
      };
      const nKey = key(next);
      if (closed.has(nKey)) continue;

      const isGoal = Math.hypot(next.gx - g.gx, next.gy - g.gy) < 0.35;
      if (!isGoal && isPointBlocked(next.gx, next.gy)) continue;

      if (d.dx !== 0 && d.dy !== 0) {
        if (
          isPointBlocked(current.gx + d.dx, current.gy) ||
          isPointBlocked(current.gx, current.gy + d.dy)
        ) {
          continue;
        }
      }

      const tentativeG = (gScore.get(cKey) ?? 0) + Math.hypot(d.dx, d.dy);
      if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, current);
        gScore.set(nKey, tentativeG);
        fScore.set(nKey, tentativeG + Math.hypot(g.gx - next.gx, g.gy - next.gy));
        if (!open.some((p) => key(p) === nKey)) {
          open.push(next);
        }
      }
    }
  }

  return [start, goal];
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
    const dx1 = curr.gx - prev.gx;
    const dy1 = curr.gy - prev.gy;
    const dx2 = next.gx - curr.gx;
    const dy2 = next.gy - curr.gy;
    const cross = Math.abs(dx1 * dy2 - dy1 * dx2);
    if (cross > 0.01) {
      out.push(curr);
    }
  }
  out.push(pt(points, points.length - 1));
  return out;
}

function getPathMetrics(path: GridCoord[], agentId: AgentId) {
  const speed = agentId === 'dash' ? 1.6 * 1.4 : 1.6;
  const cumulative: number[] = [0];
  let totalDist = 0;
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(pt(path, i).gx - pt(path, i - 1).gx, pt(path, i).gy - pt(path, i - 1).gy);
    totalDist += seg;
    cumulative.push(totalDist);
  }
  return {
    totalDist,
    durationMs: Math.max(250, (totalDist / speed) * 1000),
    cumulative,
  };
}

function samplePath(
  path: GridCoord[],
  cumulative: number[],
  totalDist: number,
  t: number
): GridCoord {
  if (path.length === 0) return { gx: 4.5, gy: 4.5 };
  if (path.length === 1 || totalDist <= 0.001) return pt(path, path.length - 1);
  const clamped = Math.max(0, Math.min(1, t));
  const targetDist = clamped * totalDist;

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

function getDepthKey(gx: number, gy: number, bias = 0): number {
  return gx + gy + bias;
}

function IsometricOffice({
  shopName,
  localTime,
  agents,
  trayCount,
  events,
  sample,
  environmentPreset = 'kirana',
  agentStyle = 'clay',
  chrome = true,
  onSelectAgent,
  onOpenTray,
  onOpenBrief,
}: OfficeProps & { environmentPreset?: EnvironmentPresetId; agentStyle?: AgentStyleId; chrome?: boolean }) {
  // chrome: the scene's own header (name, labels, camera). A host page with its own head turns it off.
  const [selectedAgent, setSelectedAgent] = useState<AgentId | null>(null);
  const [hoveredAgent, setHoveredAgent] = useState<AgentId | null>(null);
  const [focusedAgent, setFocusedAgent] = useState<AgentId | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [cameraZoom, setCameraZoom] = useState(1);
  const [followAgentCamera, setFollowAgentCamera] = useState(false);

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
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);

    const onVis = () => setTabHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      mq.removeEventListener('change', onChange);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  useEffect(() => {
    const now = performance.now();
    for (const agent of agents) {
      const currentPos = positionsRef.current[agent.id] ?? DESK_CONFIG[agent.id].standPos;
      const desiredTarget =
        agent.state === 'walking' && agent.walkTo
          ? resolveTargetCoord(agent.id, agent.walkTo, agent.walkTo === 'tray')
          : getRestingCoord(agent);

      const targetKey = `${desiredTarget.gx.toFixed(2)},${desiredTarget.gy.toFixed(2)}`;
      const existingWalk = walksRef.current[agent.id];

      if (reducedMotion) {
        positionsRef.current[agent.id] = desiredTarget;
        delete walksRef.current[agent.id];
        continue;
      }

      const distToTarget = Math.hypot(
        currentPos.gx - desiredTarget.gx,
        currentPos.gy - desiredTarget.gy
      );

      if (distToTarget < 0.08) {
        positionsRef.current[agent.id] = desiredTarget;
        delete walksRef.current[agent.id];
      } else if (!existingWalk || existingWalk.targetKey !== targetKey) {
        const path = computeGridPath(currentPos, desiredTarget);
        const metrics = getPathMetrics(path, agent.id);
        walksRef.current[agent.id] = {
          path,
          cumulative: metrics.cumulative,
          totalDist: metrics.totalDist,
          durationMs: metrics.durationMs,
          startTime: now,
          targetKey,
        };
      }
    }
    setTick((t) => t + 1);
  }, [agents, reducedMotion]);

  useEffect(() => {
    const now = performance.now();
    const newFx: ActiveFx[] = [];
    const liveMessages: string[] = [];

    for (const ev of events) {
      if (seenEventsRef.current.has(ev.id)) continue;
      seenEventsRef.current.add(ev.id);

      const agentObj = agents.find((a) => a.id === ev.agent);
      const agentName = agentObj?.name ?? ev.agent;

      if (ev.kind === 'finding') {
        liveMessages.push(`${agentName} raised a finding and walked it to Munshi.`);
        newFx.push({ eventId: ev.id, kind: ev.kind, agent: ev.agent, startTime: now, durationMs: 2400 });
      } else if (ev.kind === 'draft') {
        liveMessages.push(`${agentName} put a draft in your tray.`);
        newFx.push({ eventId: ev.id, kind: ev.kind, agent: ev.agent, startTime: now, durationMs: 2400 });
      } else if (ev.kind === 'approved') {
        liveMessages.push(`Approved draft from ${agentName} filed into the shop ledgers.`);
        newFx.push({ eventId: ev.id, kind: ev.kind, agent: ev.agent, startTime: now, durationMs: 2200 });
      } else if (ev.kind === 'message') {
        liveMessages.push(`A customer message arrived for ${agentName}.`);
        newFx.push({ eventId: ev.id, kind: ev.kind, agent: ev.agent, startTime: now, durationMs: 2000 });
      } else if (ev.kind === 'memory') {
        liveMessages.push(`${agentName} stored an owner decision in memory.`);
        newFx.push({ eventId: ev.id, kind: ev.kind, agent: ev.agent, startTime: now, durationMs: 2000 });
      }
    }

    if (liveMessages.length > 0) {
      setAnnouncement(liveMessages.join(' '));
    }
    if (newFx.length > 0) {
      setActiveFxList((prev) => [...prev, ...newFx]);
    }
  }, [events, agents]);

  useEffect(() => {
    if (tabHidden) return;
    let rafId: number | null = null;

    const step = (now: number) => {
      let hasActiveAnimation = false;

      for (const id of Object.keys(walksRef.current) as AgentId[]) {
        const w = walksRef.current[id];
        if (!w) continue;
        const elapsed = now - w.startTime;
        const progress = Math.min(1, elapsed / w.durationMs);
        positionsRef.current[id] = samplePath(w.path, w.cumulative, w.totalDist, progress);
        if (progress >= 1) {
          delete walksRef.current[id];
        } else {
          hasActiveAnimation = true;
        }
      }

      setActiveFxList((prev) => {
        const remaining = prev.filter((fx) => now - fx.startTime < fx.durationMs);
        if (remaining.length > 0) hasActiveAnimation = true;
        return remaining.length === prev.length ? prev : remaining;
      });

      setTick((t) => (t + 1) % 100000);

      if (hasActiveAnimation || Object.keys(walksRef.current).length > 0) {
        rafId = requestAnimationFrame(step);
      }
    };

    if (Object.keys(walksRef.current).length > 0 || activeFxList.length > 0) {
      rafId = requestAnimationFrame(step);
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [activeFxList.length, tabHidden, agents]); // a walk with no event attached starts the loop too

  const timeInfo = useMemo(() => parseTimeOfDay(localTime), [localTime]);

  const cameraTransform = useMemo(() => {
    if (!selectedAgent || reducedMotion) return `translate(0px, 0px) scale(${cameraZoom})`;
    const pos = positionsRef.current[selectedAgent] ?? DESK_CONFIG[selectedAgent].standPos;
    const screen = isoToScreen(pos.gx, pos.gy);
    const scale = Math.min(1.22, cameraZoom * 1.08);
    const tx = (680 - screen.x) * 0.22;
    const ty = (420 - screen.y) * 0.22;
    return `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${scale.toFixed(2)})`;
  }, [selectedAgent, reducedMotion, tick, cameraZoom, followAgentCamera]);

  const handleAgentClick = (id: AgentId) => {
    setSelectedAgent(id);
    onSelectAgent(id);
  };

  const sortedSceneItems = useMemo(() => {
    type SceneItem =
      | { kind: 'desk'; agentId: AgentId; agent?: Agent | undefined; gx: number; gy: number; depth: number }
      | { kind: 'shelf'; gx: number; gy: number; depth: number }
      | { kind: 'tray'; gx: number; gy: number; depth: number }
      | { kind: 'plant'; id: string; gx: number; gy: number; depth: number }
      | { kind: 'lounge'; gx: number; gy: number; depth: number }
      | { kind: 'vault'; gx: number; gy: number; depth: number }
      | { kind: 'agent'; agent: Agent; gx: number; gy: number; depth: number };

    const items: SceneItem[] = [];

    (Object.keys(DESK_CONFIG) as AgentId[]).forEach((id) => {
      const cfg = DESK_CONFIG[id];
      const ag = agents.find((a) => a.id === id);
      items.push({
        kind: 'desk',
        agentId: id,
        agent: ag,
        gx: cfg.deskPos.gx,
        gy: cfg.deskPos.gy,
        depth: getDepthKey(cfg.deskPos.gx, cfg.deskPos.gy, 0),
      });
    });

    items.push({
      kind: 'shelf',
      gx: SPECIAL_SPOTS.shelfFurniture.gx,
      gy: SPECIAL_SPOTS.shelfFurniture.gy,
      depth: getDepthKey(SPECIAL_SPOTS.shelfFurniture.gx, SPECIAL_SPOTS.shelfFurniture.gy, 0),
    });

    items.push({
      kind: 'plant',
      id: 'corner-plant-1',
      gx: 0.7,
      gy: 0.7,
      depth: getDepthKey(0.7, 0.7, 0),
    });

    items.push({
      kind: 'plant',
      id: 'corner-plant-2',
      gx: 9.1,
      gy: 4.2,
      depth: getDepthKey(9.1, 4.2, 0),
    });

    items.push({
      kind: 'vault',
      gx: SPECIAL_SPOTS.vaultCabinet.gx,
      gy: SPECIAL_SPOTS.vaultCabinet.gy,
      depth: getDepthKey(SPECIAL_SPOTS.vaultCabinet.gx, SPECIAL_SPOTS.vaultCabinet.gy, 0),
    });

    items.push({
      kind: 'lounge',
      gx: SPECIAL_SPOTS.loungeTable.gx,
      gy: SPECIAL_SPOTS.loungeTable.gy,
      depth: getDepthKey(SPECIAL_SPOTS.loungeTable.gx, SPECIAL_SPOTS.loungeTable.gy, 0),
    });

    items.push({
      kind: 'tray',
      gx: SPECIAL_SPOTS.trayTable.gx,
      gy: SPECIAL_SPOTS.trayTable.gy,
      depth: getDepthKey(SPECIAL_SPOTS.trayTable.gx, SPECIAL_SPOTS.trayTable.gy, 0.05),
    });

    agents.forEach((ag) => {
      const pos = positionsRef.current[ag.id] ?? DESK_CONFIG[ag.id].standPos;
      items.push({
        kind: 'agent',
        agent: ag,
        gx: pos.gx,
        gy: pos.gy,
        depth: getDepthKey(pos.gx, pos.gy, 0.12),
      });
    });

    return items.sort((a, b) => a.depth - b.depth);
  }, [agents, tick]);

  const topCorner = isoToScreen(0, 0);
  const rightCorner = isoToScreen(GRID_SIZE, 0);
  const bottomCorner = isoToScreen(GRID_SIZE, GRID_SIZE);
  const leftCorner = isoToScreen(0, GRID_SIZE);
  const SLAB_H = 26;
  const WALL_H = 132;
  const SVG_W = 1360;
  const SVG_H = 820;

  return (
    <section
      className="munshi-office-root"
      data-env={environmentPreset}
      data-agent-style={agentStyle}
      aria-label={`${shopName} AI back office`}
    >

      {/* Header bar with shopName, permanent Sample shop label, and Camera Controls */}
      {chrome && (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 24px 4px 24px',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span
            style={{
              fontFamily: 'var(--font-title)',
              fontSize: '21px',
              fontWeight: 700,
              letterSpacing: '-0.01em',
            }}
          >
            {shopName}
          </span>
          {sample && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                fontWeight: 600,
                padding: '3px 9px',
                borderRadius: '999px',
                background: 'var(--amber-wash)',
                color: 'var(--amber)',
                border: '1px solid var(--edge)',
              }}
            >
              Sample shop
            </span>
          )}
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              padding: '3px 9px',
              borderRadius: '999px',
              background: 'var(--teal-wash)',
              color: 'var(--teal)',
            }}
          >
            10×10 Grand Studio Floor
          </span>
        </div>

        {/* Camera Zoom & Focus Controls */}
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11.5px',
            color: 'var(--ink-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span style={{ marginRight: '6px' }}>Agents propose · You approve</span>
          <button
            type="button"
            onClick={() => setCameraZoom((z) => Math.max(0.88, +(z - 0.08).toFixed(2)))}
            style={{
              padding: '3px 8px',
              borderRadius: '6px',
              border: '1px solid var(--edge)',
              background: 'var(--card)',
              color: 'var(--ink)',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
            }}
            title="Zoom Out"
          >
            − Zoom
          </button>
          <button
            type="button"
            onClick={() => setCameraZoom(1)}
            style={{
              padding: '3px 8px',
              borderRadius: '6px',
              border: '1px solid var(--edge)',
              background: 'var(--card)',
              color: 'var(--ink)',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
            }}
          >
            {Math.round(cameraZoom * 100) + '%'}
          </button>
          <button
            type="button"
            onClick={() => setCameraZoom((z) => Math.min(1.24, +(z + 0.08).toFixed(2)))}
            style={{
              padding: '3px 8px',
              borderRadius: '6px',
              border: '1px solid var(--edge)',
              background: 'var(--card)',
              color: 'var(--ink)',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
            }}
            title="Zoom In"
          >
            + Zoom
          </button>
          <button
            type="button"
            onClick={() => setFollowAgentCamera((f) => !f)}
            style={{
              padding: '3px 9px',
              borderRadius: '6px',
              border: followAgentCamera ? '1px solid var(--coral)' : '1px solid var(--edge)',
              background: followAgentCamera ? 'var(--coral)' : 'var(--card)',
              color: followAgentCamera ? '#FFFDF9' : 'var(--ink)',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
            }}
          >
            {followAgentCamera ? '🎯 Camera Tracking On' : '🎥 Wide Studio View'}
          </button>
        </div>
      </div>
      )}

      <div className="munshi-diorama-wrap">
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          width="100%"
          height="100%"
          role="img"
          aria-label="Expansive isometric view of the Munshi AI back office with seven agents, architectural courtyard, and your approval tray"
        >
          <defs>
            <filter id="soft-shadow" x="-25%" y="-25%" width="150%" height="150%">
              <feDropShadow dx="0" dy="14" stdDeviation="12" floodColor="#201A13" floodOpacity="0.14" />
            </filter>
            <filter id="warm-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
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

          <g
            style={{
              transform: cameraTransform,
              transformOrigin: '680px 420px',
              transition: reducedMotion ? 'none' : 'transform 480ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            {/* 0. OUTER COURTYARD / VERANDAH SURROUNDING PLINTH FOR ARCHITECTURAL DEPTH */}
            {(() => {
              const oTop = isoToScreen(-0.55, -0.55, -10);
              const oRight = isoToScreen(GRID_SIZE + 0.65, -0.55, -10);
              const oBottom = isoToScreen(GRID_SIZE + 0.65, GRID_SIZE + 0.65, -10);
              const oLeft = isoToScreen(-0.55, GRID_SIZE + 0.65, -10);
              return (
                <g opacity="0.55">
                  <polygon
                    points={`${oTop.x},${oTop.y} ${oRight.x},${oRight.y} ${oBottom.x},${oBottom.y} ${oLeft.x},${oLeft.y}`}
                    fill="var(--slab-l)"
                    stroke="var(--edge)"
                    strokeWidth="1"
                  />
                </g>
              );
            })()}

            {/* 1. FLOOR PLATE & MULTI-LAYER ARCHITECTURAL SLAB THICKNESS */}
            <g filter="url(#soft-shadow)">
              {/* Left front slab thickness (#D9CCB2) */}
              <polygon
                points={`${leftCorner.x},${leftCorner.y} ${bottomCorner.x},${bottomCorner.y} ${bottomCorner.x},${bottomCorner.y + SLAB_H} ${leftCorner.x},${leftCorner.y + SLAB_H}`}
                fill="var(--slab-l)"
              />
              {/* Right front slab thickness (#CBBD9F) */}
              <polygon
                points={`${bottomCorner.x},${bottomCorner.y} ${rightCorner.x},${rightCorner.y} ${rightCorner.x},${rightCorner.y + SLAB_H} ${bottomCorner.x},${bottomCorner.y + SLAB_H}`}
                fill="var(--slab-r)"
              />
              {/* Subtle brass/terracotta trim line along the slab */}
              <line
                x1={leftCorner.x}
                y1={leftCorner.y + 8}
                x2={bottomCorner.x}
                y2={bottomCorner.y + 8}
                stroke="var(--coral)"
                strokeWidth="1.5"
                opacity="0.45"
              />
              <line
                x1={bottomCorner.x}
                y1={bottomCorner.y + 8}
                x2={rightCorner.x}
                y2={rightCorner.y + 8}
                stroke="var(--coral)"
                strokeWidth="1.5"
                opacity="0.35"
              />
              {/* Main 10x10 floor plate */}
              <polygon
                points={`${topCorner.x},${topCorner.y} ${rightCorner.x},${rightCorner.y} ${bottomCorner.x},${bottomCorner.y} ${leftCorner.x},${leftCorner.y}`}
                fill="var(--floor)"
                stroke="var(--edge)"
                strokeWidth="1.4"
              />
              {/* Warm ambient studio light pool across center floor */}
              <polygon
                points={`${topCorner.x},${topCorner.y} ${rightCorner.x},${rightCorner.y} ${bottomCorner.x},${bottomCorner.y} ${leftCorner.x},${leftCorner.y}`}
                fill="url(#floor-warmth)"
              />
            </g>

            {/* Front Entrance Verandah Steps at Door (0.8, 9.8) & Tray Corner */}
            {(() => {
              const s1 = isoToScreen(0.5, GRID_SIZE, 0);
              const s2 = isoToScreen(2.2, GRID_SIZE, 0);
              const s3 = isoToScreen(2.2, GRID_SIZE + 0.45, -8);
              const s4 = isoToScreen(0.5, GRID_SIZE + 0.45, -8);
              return (
                <g>
                  <polygon
                    points={`${s1.x},${s1.y} ${s2.x},${s2.y} ${s3.x},${s3.y} ${s4.x},${s4.y}`}
                    fill="var(--desk-top)"
                    stroke="var(--edge)"
                    strokeWidth="1"
                  />
                  <polygon
                    points={`${s4.x},${s4.y} ${s3.x},${s3.y} ${s3.x},${s3.y + 10} ${s4.x},${s4.y + 10}`}
                    fill="var(--slab-l)"
                  />
                </g>
              );
            })()}

            {/* 10x10 Isometric Tile Lines + Subtle Terracotta Corner Inlays */}
            <g stroke="var(--grid)" strokeWidth="1">
              {Array.from({ length: GRID_SIZE - 1 }, (_, i) => i + 1).map((idx) => {
                const a1 = isoToScreen(idx, 0);
                const a2 = isoToScreen(idx, GRID_SIZE);
                const b1 = isoToScreen(0, idx);
                const b2 = isoToScreen(GRID_SIZE, idx);
                return (
                  <Fragment key={idx}>
                    <line x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y} />
                    <line x1={b1.x} y1={b1.y} x2={b2.x} y2={b2.y} />
                  </Fragment>
                );
              })}
            </g>

            {/* ENVIRONMENT FLOOR DECORATION: Grand Woven Dhurrie Rug / Rangoli Mandala under Lead Desk */}
            {(() => {
              const c = isoToScreen(4.5, 4.5);
              if (environmentPreset === 'haveli' || environmentPreset === 'bazaar') {
                return (
                  <g transform={`translate(${c.x}, ${c.y})`} opacity="0.82">
                    <ellipse cx="0" cy="0" rx="115" ry="58" fill="none" stroke="var(--coral)" strokeWidth="1.8" strokeDasharray="7 4" />
                    <ellipse cx="0" cy="0" rx="96" ry="48" fill="var(--amber-wash)" opacity="0.58" />
                    <polygon points="0,-42 84,0 0,42 -84,0" fill="none" stroke="var(--coral)" strokeWidth="1.4" />
                    <ellipse cx="0" cy="0" rx="48" ry="24" fill="none" stroke="var(--teal)" strokeWidth="1.2" opacity="0.6" />
                  </g>
                );
              }
              if (environmentPreset === 'salon') {
                return (
                  <g transform={`translate(${c.x}, ${c.y})`} opacity="0.76">
                    <ellipse cx="0" cy="0" rx="112" ry="56" fill="var(--teal-wash)" stroke="var(--teal)" strokeWidth="1.4" />
                    <ellipse cx="18" cy="-8" rx="72" ry="36" fill="var(--amber-wash)" opacity="0.65" />
                  </g>
                );
              }
              const r1 = isoToScreen(2.8, 2.8);
              const r2 = isoToScreen(6.2, 2.8);
              const r3 = isoToScreen(6.2, 6.2);
              const r4 = isoToScreen(2.8, 6.2);
              return (
                <g>
                  <polygon
                    points={`${r1.x},${r1.y} ${r2.x},${r2.y} ${r3.x},${r3.y} ${r4.x},${r4.y}`}
                    fill="var(--amber-wash)"
                    stroke="var(--coral)"
                    strokeWidth="1.4"
                    opacity="0.52"
                  />
                  {/* Woven dhurrie border stripes */}
                  <line x1={r1.x} y1={r1.y + 6} x2={r4.x + 6} y2={r4.y} stroke="var(--coral)" strokeWidth="2" opacity="0.45" />
                  <line x1={r2.x - 6} y1={r2.y} x2={r3.x} y2={r3.y - 6} stroke="var(--coral)" strokeWidth="2" opacity="0.45" />
                </g>
              );
            })()}

            {/* 2. EXPANDED ARCHITECTURAL BACK WALLS WITH WAINSCOTING, PILLARS & TIMBER CORNICE */}
            {/* Left Wall (#EFE5D3) */}
            <polygon
              points={`${leftCorner.x},${leftCorner.y} ${topCorner.x},${topCorner.y} ${topCorner.x},${topCorner.y - WALL_H} ${leftCorner.x},${leftCorner.y - WALL_H}`}
              fill="var(--wall-l)"
              stroke="var(--edge)"
              strokeWidth="1.2"
            />
            {/* Right Wall (#E6D9C1) */}
            <polygon
              points={`${topCorner.x},${topCorner.y} ${rightCorner.x},${rightCorner.y} ${rightCorner.x},${rightCorner.y - WALL_H} ${topCorner.x},${topCorner.y - WALL_H}`}
              fill="var(--wall-r)"
              stroke="var(--edge)"
              strokeWidth="1.2"
            />
            {/* Wall Wainscoting / Dado Rail at height gz = 34 */}
            {(() => {
              const wl1 = isoToScreen(0, GRID_SIZE, 32);
              const wc = isoToScreen(0, 0, 32);
              const wr1 = isoToScreen(GRID_SIZE, 0, 32);
              return (
                <g opacity="0.55">
                  <polygon
                    points={`${leftCorner.x},${leftCorner.y} ${topCorner.x},${topCorner.y} ${wc.x},${wc.y} ${wl1.x},${wl1.y}`}
                    fill="var(--slab-l)"
                  />
                  <polygon
                    points={`${topCorner.x},${topCorner.y} ${rightCorner.x},${rightCorner.y} ${wr1.x},${wr1.y} ${wc.x},${wc.y}`}
                    fill="var(--slab-r)"
                  />
                  <line x1={wl1.x} y1={wl1.y} x2={wc.x} y2={wc.y} stroke="var(--edge)" strokeWidth="2" />
                  <line x1={wc.x} y1={wc.y} x2={wr1.x} y2={wr1.y} stroke="var(--edge)" strokeWidth="2" />
                </g>
              );
            })()}

            {/* Exposed Wooden Ceiling Rafters / Studio Beams projecting partially from top walls */}
            <g opacity="0.45">
              {[2, 4, 6, 8].map((pos) => {
                const bStartL = isoToScreen(0, pos, WALL_H);
                const bEndL = isoToScreen(1.4, pos, WALL_H - 6);
                const bStartR = isoToScreen(pos, 0, WALL_H);
                const bEndR = isoToScreen(pos, 1.4, WALL_H - 6);
                return (
                  <Fragment key={`beam-${pos}`}>
                    <line x1={bStartL.x} y1={bStartL.y} x2={bEndL.x} y2={bEndL.y} stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" />
                    <line x1={bStartR.x} y1={bStartR.y} x2={bEndR.x} y2={bEndR.y} stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" />
                  </Fragment>
                );
              })}
            </g>

            {/* ENVIRONMENT ARCHITECTURAL MOTIFS ON WALLS */}
            {environmentPreset === 'haveli' && (
              <g opacity="0.65">
                {[1.5, 3.2, 5.0, 6.8, 8.5].map((pos, idx) => {
                  const archL = isoToScreen(0, pos, WALL_H - 10);
                  const archR = isoToScreen(pos, 0, WALL_H - 10);
                  return (
                    <Fragment key={idx}>
                      <circle cx={archL.x} cy={archL.y} r="5.5" fill="var(--coral)" />
                      <circle cx={archR.x} cy={archR.y} r="5.5" fill="var(--coral)" />
                    </Fragment>
                  );
                })}
              </g>
            )}

            {(environmentPreset === 'bazaar' || environmentPreset === 'kirana') && (
              <g>
                {/* Festive Marigold Toran Garland strung along top wall edge */}
                {[0.9, 1.8, 2.7, 3.6, 4.5, 5.4, 6.3, 7.2, 8.1, 9.0].map((step, i) => {
                  const pL = isoToScreen(0, step, WALL_H - 10 - (i % 2) * 5);
                  const pR = isoToScreen(step, 0, WALL_H - 10 - (i % 2) * 5);
                  return (
                    <Fragment key={i}>
                      <circle cx={pL.x} cy={pL.y} r="4.2" fill={i % 2 === 0 ? 'var(--coral)' : 'var(--amber)'} />
                      <circle cx={pR.x} cy={pR.y} r="4.2" fill={i % 2 === 0 ? 'var(--amber)' : 'var(--coral)'} />
                    </Fragment>
                  );
                })}
              </g>
            )}

            {environmentPreset === 'salon' && (
              <g>
                {[1.2, 3.2, 6.5, 8.4].map((gy, idx) => {
                  const vp = isoToScreen(0, gy, WALL_H - 8);
                  return (
                    <g key={idx} transform={`translate(${vp.x}, ${vp.y})`}>
                      <line x1="0" y1="0" x2="0" y2="28" stroke="var(--ok)" strokeWidth="1.8" />
                      <circle cx="-3.5" cy="12" r="3.5" fill="var(--ok)" />
                      <circle cx="3.5" cy="21" r="3.8" fill="var(--teal)" />
                    </g>
                  );
                })}
              </g>
            )}

            {/* LEFT WALL: Grand Double-Tier Shelf of Ledgers (Bahi-Khata volumes) */}
            {(() => {
              const s1 = isoToScreen(0, 1.2, 54);
              const s2 = isoToScreen(0, 3.0, 54);
              const s3 = isoToScreen(0, 1.2, 84);
              const s4 = isoToScreen(0, 3.0, 84);
              return (
                <g>
                  {/* Lower shelf plank */}
                  <polygon
                    points={`${s1.x},${s1.y} ${s2.x},${s2.y} ${s2.x + 12},${s2.y + 6} ${s1.x + 12},${s1.y + 6}`}
                    fill="var(--slab-r)"
                    stroke="var(--edge)"
                    strokeWidth="0.8"
                  />
                  {/* Upper shelf plank */}
                  <polygon
                    points={`${s3.x},${s3.y} ${s4.x},${s4.y} ${s4.x + 12},${s4.y + 6} ${s3.x + 12},${s3.y + 6}`}
                    fill="var(--slab-r)"
                    stroke="var(--edge)"
                    strokeWidth="0.8"
                  />
                  {[0.2, 0.45, 0.72, 1.0, 1.28, 1.52].map((offset, idx) => {
                    const bp = isoToScreen(0.08, 1.3 + offset, 56);
                    const bpTop = isoToScreen(0.08, 1.35 + offset * 0.9, 86);
                    const colors = ['var(--coral)', 'var(--teal)', 'var(--ink)', 'var(--amber)', 'var(--coral-deep)'];
                    return (
                      <Fragment key={idx}>
                        <polygon
                          points={`${bp.x},${bp.y} ${bp.x + 8},${bp.y + 4} ${bp.x + 8},${bp.y - 16} ${bp.x},${bp.y - 20}`}
                          fill={colors[idx % colors.length]}
                        />
                        {idx < 4 && (
                          <polygon
                            points={`${bpTop.x},${bpTop.y} ${bpTop.x + 8},${bpTop.y + 4} ${bpTop.x + 8},${bpTop.y - 15} ${bpTop.x},${bpTop.y - 19}`}
                            fill={colors[(idx + 2) % colors.length]}
                          />
                        )}
                      </Fragment>
                    );
                  })}
                </g>
              );
            })()}

            {/* LEFT WALL: Morning Brief Board (gy 3.8..6.0) */}
            {(() => {
              const b1 = isoToScreen(0, 3.8, 96);
              const b2 = isoToScreen(0, 6.0, 96);
              const b3 = isoToScreen(0, 6.0, 38);
              const b4 = isoToScreen(0, 3.8, 38);
              const t1 = isoToScreen(0, 4.1, 84);
              const t2 = isoToScreen(0, 5.6, 84);
              return (
                <g>
                  <polygon
                    points={`${b1.x},${b1.y} ${b2.x},${b2.y} ${b3.x},${b3.y} ${b4.x},${b4.y}`}
                    fill="var(--card)"
                    stroke="var(--coral)"
                    strokeWidth="2"
                  />
                  <circle cx={(b1.x + b2.x) / 2} cy={(b1.y + b2.y) / 2 + 2} r="3.8" fill="var(--coral)" />
                  <line x1={t1.x} y1={t1.y} x2={t2.x} y2={t2.y} stroke="var(--coral)" strokeWidth="3.2" strokeLinecap="round" />
                  {[74, 65, 56, 47].map((z, i) => {
                    const l1 = isoToScreen(0, 4.1, z);
                    const l2 = isoToScreen(0, i === 3 ? 5.1 : 5.7, z);
                    return (
                      <line
                        key={z}
                        x1={l1.x}
                        y1={l1.y}
                        x2={l2.x}
                        y2={l2.y}
                        stroke="var(--slab-r)"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                      />
                    );
                  })}
                </g>
              );
            })()}

            {/* LEFT WALL: Arched Shop Verandah Doorway (gy 7.4..9.0) */}
            {(() => {
              const d1 = isoToScreen(0, 7.5, 92);
              const d2 = isoToScreen(0, 9.0, 92);
              const d3 = isoToScreen(0, 9.0, 0);
              const d4 = isoToScreen(0, 7.5, 0);
              return (
                <g>
                  <polygon
                    points={`${d1.x},${d1.y} ${d2.x},${d2.y} ${d3.x},${d3.y} ${d4.x},${d4.y}`}
                    fill="var(--desk-side-r)"
                    stroke="var(--ink)"
                    strokeWidth="1.5"
                    opacity="0.85"
                  />
                  {/* Warm glass transom window inside door */}
                  <polygon
                    points={`${d1.x},${d1.y + 8} ${d2.x},${d2.y + 8} ${d2.x},${d2.y + 34} ${d1.x},${d1.y + 34}`}
                    fill="var(--teal-wash)"
                    opacity="0.75"
                  />
                </g>
              );
            })()}

            {/* RIGHT WALL: Panoramic Studio Window with Outdoor Silhouette, Volumetric Sunbeams & Wall Clock */}
            {(() => {
              const w1 = isoToScreen(2.2, 0, 104);
              const w2 = isoToScreen(6.0, 0, 104);
              const w3 = isoToScreen(6.0, 0, 38);
              const w4 = isoToScreen(2.2, 0, 38);
              const floorBeam1 = isoToScreen(2.2, 0, 0);
              const floorBeam2 = isoToScreen(6.0, 0, 0);
              const floorBeam3 = isoToScreen(6.0, 4.2, 0);
              const floorBeam4 = isoToScreen(2.2, 4.2, 0);

              const clockCenter = isoToScreen(7.4, 0, 82);
              const hrAngle = ((timeInfo.hours % 12) + timeInfo.minutes / 60) * 30 - 90;
              const minAngle = timeInfo.minutes * 6 - 90;
              const hrRad = (hrAngle * Math.PI) / 180;
              const minRad = (minAngle * Math.PI) / 180;

              return (
                <g>
                  {/* Volumetric floor light projection */}
                  <polygon
                    points={`${floorBeam1.x},${floorBeam1.y} ${floorBeam2.x},${floorBeam2.y} ${floorBeam3.x},${floorBeam3.y} ${floorBeam4.x},${floorBeam4.y}`}
                    fill="url(#window-godray)"
                    opacity={timeInfo.beamOpacity * 2.2}
                  />
                  {/* Diagonal volumetric sunbeam rays from window to floor */}
                  <polygon
                    points={`${w1.x},${w1.y} ${w2.x},${w2.y} ${floorBeam3.x},${floorBeam3.y} ${floorBeam4.x},${floorBeam4.y}`}
                    fill="url(#window-godray)"
                    opacity={timeInfo.beamOpacity * 0.85}
                    pointerEvents="none"
                  />
                  {/* Window casing */}
                  <polygon
                    points={`${w1.x},${w1.y} ${w2.x},${w2.y} ${w3.x},${w3.y} ${w4.x},${w4.y}`}
                    fill="var(--teal-wash)"
                    opacity={timeInfo.windowOpacity}
                    stroke="var(--ink)"
                    strokeWidth="2.2"
                  />
                  {/* Subtle outdoor neem foliage / skyline silhouette inside window */}
                  <circle cx={w1.x + 48} cy={w1.y + 42} r="18" fill="var(--teal)" opacity="0.16" />
                  <circle cx={w1.x + 76} cy={w1.y + 52} r="22" fill="var(--ok)" opacity="0.14" />
                  <circle cx={w1.x + 135} cy={w1.y + 78} r="20" fill="var(--teal)" opacity="0.15" />

                  {environmentPreset === 'monsoon' && (
                    <g stroke="var(--teal)" strokeWidth="1.2" opacity="0.6">
                      <line x1={w1.x + 24} y1={w1.y + 10} x2={w1.x + 12} y2={w1.y + 36} />
                      <line x1={w1.x + 62} y1={w1.y + 22} x2={w1.x + 50} y2={w1.y + 48} />
                      <line x1={w1.x + 104} y1={w1.y + 38} x2={w1.x + 92} y2={w1.y + 64} />
                      <line x1={w1.x + 146} y1={w1.y + 52} x2={w1.x + 134} y2={w1.y + 78} />
                    </g>
                  )}
                  {/* 3-pane Mullion bars */}
                  {[0.33, 0.66].map((frac) => {
                    const mx1 = w1.x + (w2.x - w1.x) * frac;
                    const my1 = w1.y + (w2.y - w1.y) * frac;
                    const mx2 = w4.x + (w3.x - w4.x) * frac;
                    const my2 = w4.y + (w3.y - w4.y) * frac;
                    return (
                      <line
                        key={frac}
                        x1={mx1}
                        y1={my1}
                        x2={mx2}
                        y2={my2}
                        stroke="var(--wall-r)"
                        strokeWidth="2.4"
                      />
                    );
                  })}

                  {/* Wall Clock */}
                  <g transform={`translate(${clockCenter.x}, ${clockCenter.y})`}>
                    <ellipse cx="0" cy="0" rx="16" ry="18" fill="var(--card)" stroke="var(--ink)" strokeWidth="1.8" />
                    <line
                      x1="0"
                      y1="0"
                      x2={Math.cos(hrRad) * 7.5}
                      y2={Math.sin(hrRad) * 7.5}
                      stroke="var(--ink)"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <line
                      x1="0"
                      y1="0"
                      x2={Math.cos(minRad) * 11}
                      y2={Math.sin(minRad) * 11}
                      stroke="var(--coral)"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <circle cx="0" cy="0" r="1.8" fill="var(--ink)" />
                  </g>
                </g>
              );
            })()}

            {/* 3. DEPTH-SORTED FURNITURE, ARCHITECTURAL PROPS & AGENTS */}
            {sortedSceneItems.map((item) => {
              if (item.kind === 'plant') {
                const p = isoToScreen(item.gx, item.gy);
                return (
                  <g key={item.id} transform={`translate(${p.x}, ${p.y})`}>
                    <ellipse cx="0" cy="3" rx="15" ry="7.5" fill="var(--shadow)" />
                    {/* Terracotta planter pot */}
                    <path d="M -10 -12 L 10 -12 L 7 3 L -7 3 Z" fill="var(--coral-deep)" />
                    <ellipse cx="0" cy="-12" rx="10" ry="4" fill="var(--coral)" />
                    {/* Lush tropical leaves */}
                    <ellipse cx="-7" cy="-20" rx="6" ry="11" transform="rotate(-24 -7 -20)" fill="var(--ok)" />
                    <ellipse cx="7" cy="-21" rx="6" ry="11" transform="rotate(22 7 -21)" fill="var(--teal)" />
                    <ellipse cx="0" cy="-25" rx="5.5" ry="12" fill="var(--ok)" />
                  </g>
                );
              }

              if (item.kind === 'vault') {
                // Brass & Teak Archive Credenza near Keeper (8.4, 1.1)
                const p = isoToScreen(item.gx, item.gy);
                return (
                  <g key="archive-credenza" transform={`translate(${p.x}, ${p.y})`}>
                    <ellipse cx="0" cy="5" rx="28" ry="14" fill="var(--shadow)" />
                    <polygon points="-22,-18 0,-7 0,8 -22,-3" fill="var(--desk-side-l)" />
                    <polygon points="0,-7 22,-18 22,-3 0,8" fill="var(--desk-side-r)" />
                    <polygon points="0,-29 22,-18 0,-7 -22,-18" fill="var(--desk-top)" stroke="var(--edge)" strokeWidth="1" />
                    {/* Brass safe dial on side */}
                    <circle cx="-10" cy="-5" r="3.5" fill="var(--amber)" />
                    {/* Small brass diya / lamp on top */}
                    <circle cx="0" cy="-19" r="3" fill="var(--coral)" />
                  </g>
                );
              }

              if (item.kind === 'lounge') {
                // Customer Chai & Khata Low Seating Charpai/Deewan Table in front-left wing (2.0, 8.1)
                const p = isoToScreen(item.gx, item.gy);
                return (
                  <g key="chai-lounge" transform={`translate(${p.x}, ${p.y})`}>
                    <ellipse cx="0" cy="6" rx="36" ry="18" fill="var(--shadow)" />
                    {/* Woven rug under lounge */}
                    <ellipse cx="0" cy="3" rx="44" ry="22" fill="var(--teal-wash)" opacity="0.6" />
                    {/* Low wooden chowki table */}
                    <polygon points="-24,-6 0,6 0,13 -24,1" fill="var(--desk-side-l)" />
                    <polygon points="0,6 24,-6 24,1 0,13" fill="var(--desk-side-r)" />
                    <polygon points="0,-18 24,-6 0,6 -24,-6" fill="var(--desk-top)" stroke="var(--edge)" strokeWidth="1.1" />
                    {/* Brass kettle & two kulhad chai cups */}
                    <circle cx="-4" cy="-9" r="4.5" fill="var(--amber)" />
                    <rect x="4" y="-8" width="4" height="4.5" rx="1" fill="var(--coral-deep)" />
                    <rect x="10" y="-6" width="4" height="4.5" rx="1" fill="var(--coral-deep)" />
                    {/* Floor cushions (gaddis) around table */}
                    <ellipse cx="-26" cy="10" rx="11" ry="5.5" fill="var(--coral)" opacity="0.85" />
                    <ellipse cx="26" cy="10" rx="11" ry="5.5" fill="var(--amber)" opacity="0.85" />
                  </g>
                );
              }

              if (item.kind === 'shelf') {
                const p = isoToScreen(item.gx, item.gy);
                return (
                  <g key="stock-shelf" transform={`translate(${p.x}, ${p.y})`}>
                    <ellipse cx="0" cy="5" rx="28" ry="14" fill="var(--shadow)" />
                    <line x1="-18" y1="0" x2="-18" y2="-48" stroke="var(--ink)" strokeWidth="2.4" />
                    <line x1="18" y1="0" x2="18" y2="-48" stroke="var(--ink)" strokeWidth="2.4" />
                    {[-10, -26, -42].map((y, idx) => (
                      <g key={y}>
                        <polygon
                          points={`0,${y - 8} 23,${y} 0,${y + 8} -23,${y}`}
                          fill="var(--desk-top)"
                          stroke="var(--edge)"
                          strokeWidth="1.2"
                        />
                        <rect x="-11" y={y - 6} width="8.5" height="7" rx="1.2" fill={idx === 1 ? 'var(--coral)' : 'var(--slab-r)'} />
                        <rect x="2" y={y - 5} width="7.5" height="6" rx="1.2" fill="var(--teal)" opacity="0.8" />
                      </g>
                    ))}
                  </g>
                );
              }

              if (item.kind === 'desk') {
                const p = isoToScreen(item.gx, item.gy);
                const isLead = item.agentId === 'munshi';
                const isWorking =
                  item.agent &&
                  (item.agent.state === 'thinking' ||
                    item.agent.state === 'drafting' ||
                    item.agent.state === 'watching');

                if (isLead) {
                  return (
                    <g key="desk-munshi" transform={`translate(${p.x}, ${p.y})`}>
                      <ellipse cx="0" cy="8" rx="48" ry="24" fill="var(--shadow)" />
                      {isWorking && <ellipse cx="0" cy="2" rx="56" ry="28" fill="url(#lamp-halo)" />}
                      <path
                        d="M -42 -14 L -42 2 A 42 21 0 0 0 42 2 L 42 -14 Z"
                        fill="var(--desk-side-l)"
                      />
                      <ellipse
                        cx="0"
                        cy="-14"
                        rx="42"
                        ry="21"
                        fill="var(--desk-top)"
                        stroke="var(--coral)"
                        strokeWidth="3.2"
                      />
                      {/* Inner inlaid brass ring on lead desk */}
                      <ellipse
                        cx="0"
                        cy="-14"
                        rx="34"
                        ry="17"
                        fill="none"
                        stroke="var(--edge)"
                        strokeWidth="1"
                      />
                      {/* Dark monitor (#201A13) */}
                      <g transform="translate(-10, -25)">
                        <rect x="-10" y="-13" width="20" height="13" rx="2.5" fill="var(--ink)" />
                        {isWorking && (
                          <rect x="-8" y="-11" width="16" height="9" rx="1.5" fill="var(--coral)" opacity="0.65" />
                        )}
                        <rect x="-2.5" y="0" width="5" height="3.5" fill="var(--ink)" />
                      </g>
                      {/* Brass Desk Lamp */}
                      <g transform="translate(-24, -15)">
                        <ellipse cx="0" cy="0" rx="4" ry="2" fill="var(--amber)" />
                        <path d="M 0 0 L 0 -10 L 6 -13" fill="none" stroke="var(--amber)" strokeWidth="1.8" />
                        <polygon points="3,-13 10,-13 12,-9 1,-9" fill="var(--coral)" />
                      </g>
                      {/* Chai cup with faint steam */}
                      <g transform="translate(17, -16)">
                        <rect x="-4" y="-6" width="8" height="7" rx="2" fill="var(--card)" stroke="var(--edge)" strokeWidth="1" />
                        <ellipse cx="0" cy="-6" rx="3.5" ry="1.5" fill="var(--amber)" />
                        <path
                          d="M -1 -9 Q -3 -14 0 -17"
                          fill="none"
                          stroke="var(--ink-muted)"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                          className="munshi-steam"
                        />
                        <path
                          d="M 2.5 -8 Q 4.5 -13 1.5 -16"
                          fill="none"
                          stroke="var(--ink-muted)"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                          className="munshi-steam"
                        />
                      </g>
                    </g>
                  );
                }

                return (
                  <g key={`desk-${item.agentId}`} transform={`translate(${p.x}, ${p.y})`}>
                    <ellipse cx="0" cy="7" rx="34" ry="17" fill="var(--shadow)" />
                    {isWorking && <ellipse cx="0" cy="0" rx="40" ry="20" fill="url(#lamp-halo)" />}
                    {/* Left front face */}
                    <polygon points="-32,-12 0,4 0,16 -32,0" fill="var(--desk-side-l)" />
                    {/* Right front face */}
                    <polygon points="0,4 32,-12 32,0 0,16" fill="var(--desk-side-r)" />
                    {/* Top diamond face */}
                    <polygon
                      points="0,-28 32,-12 0,4 -32,-12"
                      fill="var(--desk-top)"
                      stroke="var(--edge)"
                      strokeWidth="1.2"
                    />
                    {/* Open Bahi-Khata ledger / paper stack on desk */}
                    <polygon points="7,-13 17,-8 11,-4 1,-9" fill="var(--card)" stroke="var(--edge)" strokeWidth="0.6" />
                    {/* Warm brass table lamp on each desk */}
                    <g transform="translate(16, -15)">
                      <ellipse cx="0" cy="0" rx="3" ry="1.6" fill="var(--amber)" />
                      <line x1="0" y1="0" x2="0" y2="-8" stroke="var(--amber)" strokeWidth="1.5" />
                      <polygon points="-4,-8 4,-8 5.5,-5 -5.5,-5" fill="var(--amber)" />
                    </g>
                    {/* Small dark monitor (#201A13) */}
                    <g transform="translate(-6, -18)">
                      <rect x="-9" y="-13" width="18" height="12.5" rx="2.2" fill="var(--ink)" />
                      {isWorking && (
                        <rect x="-7.2" y="-11.2" width="14.4" height="9" rx="1.2" fill="var(--coral)" opacity="0.65" />
                      )}
                      <rect x="-2.2" y="-0.5" width="4.4" height="3.5" fill="var(--ink)" />
                    </g>
                  </g>
                );
              }

              if (item.kind === 'tray') {
                const p = isoToScreen(item.gx, item.gy);
                const visualStack = Math.min(6, Math.max(0, trayCount));
                return (
                  <g key="owners-tray" transform={`translate(${p.x}, ${p.y})`}>
                    <ellipse cx="0" cy="10" rx="46" ry="23" fill="var(--shadow)" />
                    <ellipse cx="0" cy="4" rx="54" ry="27" fill="url(#lamp-halo)" />
                    <polygon points="-38,-10 0,9 0,20 -38,1" fill="var(--desk-side-l)" />
                    <polygon points="0,9 38,-10 38,1 0,20" fill="var(--desk-side-r)" />
                    <polygon
                      points="0,-29 38,-10 0,9 -38,-10"
                      fill="var(--desk-top)"
                      stroke="var(--coral)"
                      strokeWidth="1.6"
                    />
                    {/* Coral Approval Tray */}
                    <polygon
                      points="0,-25 26,-12 0,1 -26,-12"
                      fill="var(--coral)"
                      stroke="var(--coral-deep)"
                      strokeWidth="1.8"
                    />
                    {Array.from({ length: visualStack }, (_, idx) => {
                      const yOff = -idx * 3.6;
                      return (
                        <g key={idx} transform={`translate(0, ${yOff})`}>
                          <polygon
                            points="0,-22 18,-13 0,-4 -18,-13"
                            fill="var(--card)"
                            stroke="var(--edge)"
                            strokeWidth="1.1"
                          />
                          <line x1="-6" y1="-13.5" x2="5" y2="-13.5" stroke="var(--coral)" strokeWidth="1.6" strokeLinecap="round" />
                        </g>
                      );
                    })}
                    <g transform="translate(0, 33)">
                      <rect x="-66" y="-13" width="132" height="26" rx="13" fill="var(--coral)" />
                      <text
                        x="0"
                        y="4"
                        textAnchor="middle"
                        fill="#FFFDF9"
                        fontFamily="var(--font-mono)"
                        fontSize="12"
                        fontWeight="700"
                        letterSpacing="0.05em"
                      >
                        {trayCount > 0 ? `YOUR TRAY · ${trayCount}` : 'YOUR TRAY'}
                      </text>
                    </g>
                  </g>
                );
              }
              // [STAND-IN] How an agent stands in the room.
              if (item.kind === 'agent') {
                const p = isoToScreen(item.gx, item.gy);
                return (
                  <g key={`agent-${item.agent.id}`} transform={`translate(${p.x - 32}, ${p.y - 70})`}>
                    <AgentCharacter id={item.agent.id} state={item.agent.state} size={64} waitingCount={item.agent.waitingCount} agentStyle={agentStyle} />
                  </g>
                );
              }
              return null;
            })}
          </g>
        </svg>

        {/* ACCESSIBLE HTML BUTTON OVERLAY */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {(() => {
            const bCenter = isoToScreen(0, 4.9, 64);
            const leftPct = (bCenter.x / SVG_W) * 100;
            const topPct = (bCenter.y / SVG_H) * 100;
            return (
              <button
                type="button"
                className="munshi-hit-btn"
                onClick={onOpenBrief}
                aria-label="Morning brief board. Open today's shop brief"
                title="Open Morning Brief"
                style={{
                  pointerEvents: 'auto',
                  left: `${leftPct - 4.8}%`,
                  top: `${topPct - 5.5}%`,
                  width: '9.6%',
                  height: '11%',
                }}
              />
            );
          })()}

          {agents.map((agent) => {
            const pos = positionsRef.current[agent.id] ?? DESK_CONFIG[agent.id].standPos;
            const screen = isoToScreen(pos.gx, pos.gy);
            const leftPct = (screen.x / SVG_W) * 100;
            const topPct = ((screen.y - 24) / SVG_H) * 100;
            const lineInfo = agent.line
              ? `. ${agent.line.text}${agent.line.source ? ` (Source: ${agent.line.source.label})` : ''}`
              : '';

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
                aria-label={`${agent.name}, ${agent.role.toLowerCase()}, ${agent.state}${lineInfo}. Talk to ${agent.name}`}
                style={{
                  pointerEvents: 'auto',
                  left: `${leftPct - 3.4}%`,
                  top: `${topPct - 5.0}%`,
                  width: '6.8%',
                  height: '10.5%',
                }}
              />
            );
          })}

          {(() => {
            const tScreen = isoToScreen(SPECIAL_SPOTS.trayTable.gx, SPECIAL_SPOTS.trayTable.gy);
            const leftPct = (tScreen.x / SVG_W) * 100;
            const topPct = (tScreen.y / SVG_H) * 100;
            return (
              <button
                type="button"
                className="munshi-hit-btn"
                onClick={onOpenTray}
                aria-label={trayCount > 0 ? `Your approval tray, ${trayCount} ${trayCount === 1 ? 'draft' : 'drafts'} waiting. Open tray to review and approve` : 'Your approval tray. Open it to review and approve drafts'}
                title="Open Your Approval Tray"
                style={{
                  pointerEvents: 'auto',
                  left: `${leftPct - 6.5}%`,
                  top: `${topPct - 5.5}%`,
                  width: '13%',
                  height: '12.5%',
                }}
              />
            );
          })()}
        </div>
      </div>
    </section>
  );
}


// [STAND-IN] The characters: AgentBot's figures, with a small badge when the agent has drafts in the tray.
function AgentCharacter({ id, size, waitingCount }: { id: AgentId; state: AgentState; size: number; waitingCount?: number | undefined; agentStyle?: AgentStyleId }) {
  return (
    <svg width={size} height={(size * 112) / 96} viewBox="0 0 96 112" aria-hidden="true" overflow="visible">
      <AgentBot id={id} size={96} />
      {waitingCount ? <circle cx="82" cy="14" r="9" fill="#a33a20" /> : null}
    </svg>
  );
}

export { IsometricOffice };
