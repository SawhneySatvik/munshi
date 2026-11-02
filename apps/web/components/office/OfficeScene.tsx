"use client";

import { useRouter } from "next/navigation";
import type { Lang } from "../../lib/types";
import { IsometricOffice } from "./IsometricOffice";
import type { Agent, AgentId, AgentState } from "./types";
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

/**
 * The office as a page shows it: the scene without its own header (the page has one), at its desks. Clicking an agent
 * opens Ask; the tray opens the home, where the drafts wait; the brief board scrolls to the brief below.
 */
export function OfficeScene({ shop, lang, at, briefWritten, sample, briefId }: { shop: string; lang: Lang; at: string; briefWritten: boolean; sample: boolean; briefId: string }) {
  const router = useRouter();
  return (
    <div className="office-scene">
      <IsometricOffice
        chrome={false}
        shopName={shop}
        localTime={at}
        agents={castAgents(lang, { munshi: briefWritten ? "done" : "watching" })}
        trayCount={0}
        events={[]}
        sample={sample}
        onSelectAgent={() => router.push("/app/ask")}
        onOpenTray={() => router.push("/app")}
        onOpenBrief={() => document.getElementById(briefId)?.scrollIntoView({ behavior: "smooth", block: "start" })}
      />
    </div>
  );
}
