"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Lang } from "../../lib/types";
import { IsometricOffice } from "./IsometricOffice";
import type { OfficeView } from "./OfficeControls";
import { PRESETS, presetForKind, STYLES, VIEWS } from "./presets";
import type { Agent, AgentId, AgentState, OfficeEvent } from "./types";
import "./office.css";

// The cast at their desks. Names and roles only: what an agent is doing comes from the page, never invented here.
const CAST: { id: AgentId; name: string; role: Record<Lang, string>; model: string }[] = [
  { id: "munshi", name: "Munshi", role: { en: "The lead", hi: "मुखिया" }, model: "router" },
  { id: "tally", name: "Tally", role: { en: "Stock", hi: "स्टॉक" }, model: "vision" },
  { id: "ledger", name: "Ledger", role: { en: "Money", hi: "पैसा" }, model: "reason" },
  { id: "dash", name: "Dash", role: { en: "Fixes", hi: "सुधार" }, model: "reason" },
  { id: "echo", name: "Echo", role: { en: "Customers", hi: "ग्राहक" }, model: "voice" },
  { id: "bloom", name: "Bloom", role: { en: "Campaigns", hi: "अभियान" }, model: "narrate" },
  { id: "keeper", name: "Keeper", role: { en: "Memory", hi: "याद" }, model: "reason" },
];

export const castAgents = (lang: Lang, state: Partial<Record<AgentId, AgentState>> = {}): Agent[] =>
  CAST.map((c) => ({ id: c.id, name: c.name, role: c.role[lang], model: c.model, state: state[c.id] ?? "idle" }));

// The owner's last choice of room, look and camera, kept in this browser only. A stored value this version does not
// know is ignored; storage that is unavailable (private mode, blocked) just means the defaults.
const VIEW_KEY = "munshi.office.view";
function storedView(): Partial<OfficeView> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(VIEW_KEY) ?? "{}") as Record<string, unknown>;
    const out: Partial<OfficeView> = {};
    if (PRESETS.includes(raw.preset as never)) out.preset = raw.preset as OfficeView["preset"];
    if (STYLES.includes(raw.style as never)) out.style = raw.style as OfficeView["style"];
    if (VIEWS.includes(raw.view as never)) out.view = raw.view as OfficeView["view"];
    return out;
  } catch {
    return {};
  }
}

/**
 * The office as a page shows it: the scene without its own header (the page has one), at its desks, with its view
 * controls. The room starts as the shop's kind (a salon's own, an apparel shop's the bazaar, every other the kirana)
 * until the owner picks another. Clicking an agent opens Ask; the tray opens the home, where the drafts wait; the brief
 * board scrolls to the brief below.
 */
export function OfficeScene({
  shop,
  lang,
  at,
  briefWritten,
  states,
  events,
  sample,
  briefId,
  kind,
}: {
  shop: string;
  lang: Lang;
  at: string;
  briefWritten: boolean;
  states?: Partial<Record<AgentId, AgentState>> | undefined;
  /** what just happened in the office (a note Keeper stored) */
  events?: OfficeEvent[] | undefined;
  sample: boolean;
  briefId: string;
  /** the shop's kind (kirana, salon, apparel), which picks the room the office opens in */
  kind?: string | null | undefined;
}) {
  const router = useRouter();
  const [view, setView] = useState<OfficeView>({ preset: presetForKind(kind), style: "human", view: "isometric" });
  // Read after mount, so the server's markup and the first client render agree.
  useEffect(() => {
    setView((v) => ({ ...v, ...storedView() }));
  }, []);
  // Only what the owner picked is kept: a room never picked keeps following the shop's kind.
  const change = (next: Partial<OfficeView>) => {
    setView((v) => ({ ...v, ...next }));
    try {
      window.localStorage.setItem(VIEW_KEY, JSON.stringify({ ...storedView(), ...next }));
    } catch {
      // storage unavailable: the choice holds for this visit only
    }
  };
  return (
    <div className="office-scene">
      <IsometricOffice
        chrome={false}
        lang={lang}
        shopName={shop}
        localTime={at}
        agents={castAgents(lang, { munshi: briefWritten ? "done" : "watching", ...states })}
        trayCount={0}
        events={events ?? []}
        sample={sample}
        environmentPreset={view.preset}
        agentStyle={view.style}
        view={view.view}
        onViewChange={change}
        onSelectAgent={() => router.push("/app/ask")}
        onOpenTray={() => router.push("/app")}
        onOpenBrief={() => document.getElementById(briefId)?.scrollIntoView({ behavior: "smooth", block: "start" })}
      />
    </div>
  );
}
