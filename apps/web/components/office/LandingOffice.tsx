"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Lang } from "../../lib/types";
import { IsometricOffice } from "./IsometricOffice";
import { castAgents } from "./OfficeScene";
import type { AgentId, AgentState, OfficeEvent } from "./types";
import "./office.css";

type Beat = { state: Partial<Record<AgentId, AgentState>>; walk?: Partial<Record<AgentId, "lead" | "tray" | "shelf">>; event?: OfficeEvent["kind"]; agent?: AgentId; tray: number };

// One loop on the sample shop, a beat every few seconds: Tally counts the shelf, Ledger takes a short payout to Munshi,
// Dash drafts the reorder into the tray, the owner approves it. Scripted and labelled as a sample; it writes nothing.
const BEATS: Beat[] = [
  { state: { munshi: "watching", tally: "walking" }, walk: { tally: "shelf" }, tray: 1 },
  { state: { munshi: "watching", tally: "thinking", ledger: "walking" }, walk: { ledger: "lead" }, event: "finding", agent: "ledger", tray: 1 },
  { state: { munshi: "thinking", ledger: "idle", dash: "drafting" }, tray: 1 },
  { state: { munshi: "watching", dash: "walking" }, walk: { dash: "tray" }, event: "draft", agent: "dash", tray: 2 },
  { state: { dash: "waiting" }, tray: 2 },
  { state: { dash: "done", munshi: "done" }, event: "approved", agent: "dash", tray: 1 },
];
const BEAT_MS = 3200;

/** The landing page's office: the sample shop's loop, the scene without its own header (the hero says what it is).
 *  Clicking an agent, the tray or the board opens the demo. */
export function LandingOffice({ lang }: { lang: Lang }) {
  const router = useRouter();
  const demo = () => router.push("/demo");
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setN((k) => k + 1), BEAT_MS);
    return () => window.clearInterval(t);
  }, []);
  const beat = BEATS[n % BEATS.length] as Beat;
  const agents = castAgents(lang, beat.state).map((a) => {
    const to = beat.walk?.[a.id];
    return to ? { ...a, walkTo: to } : a;
  });
  // Every beat that plays an event plays it once: its id carries the loop's count.
  const events: OfficeEvent[] = beat.event && beat.agent ? [{ id: `${n}-${beat.event}`, kind: beat.event, agent: beat.agent }] : [];
  return (
    <div className="office-scene">
      <IsometricOffice
        chrome={false}
        shopName="Sharma General Store"
        localTime="2026-11-02T10:30:00+05:30"
        agents={agents}
        trayCount={beat.tray}
        events={events}
        sample
        onSelectAgent={demo}
        onOpenTray={demo}
        onOpenBrief={demo}
      />
    </div>
  );
}
