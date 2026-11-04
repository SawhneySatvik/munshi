// What an agent's bubble says: one fixed phrase, picked from what the books already hold (its state and its latest run's
// trigger and outcome). The phrases live in OFFICE_WORDS; none carries a figure.
import type { AgentId, AgentState } from "./types";

export type DoingKey =
  | "reading"
  | "question"
  | "voice"
  | "photo"
  | "message"
  | "copy"
  | "fix"
  | "note"
  | "tray"
  | "approved"
  | "closed"
  | "failed"
  | "budget"
  | "off"
  | "abstained"
  | "answered"
  | "raised"
  | "watchStock"
  | "watchMoney"
  | "watchCustomers"
  | "watchShop"
  | "brief"
  | "walking"
  | "idle";

// A run still open, by what started it.
const OPEN: Record<string, DoingKey> = { question: "question", voice: "voice", photo: "photo", inbox: "message", campaign: "copy", recipe: "fix" };
// A run that has ended, by how. Proposed here means its draft is no longer waiting and was not approved.
const ENDED: Record<string, DoingKey> = { answered: "answered", abstained: "abstained", raised: "raised", proposed: "closed", failed: "failed", budget: "budget", off: "off" };
const WATCHES: Partial<Record<AgentId, DoingKey>> = { tally: "watchStock", ledger: "watchMoney", echo: "watchCustomers" };

export function doingKey(id: AgentId, state: AgentState | undefined, latest?: { outcome: string | null; trigger: string } | null): DoingKey {
  if (state === "thinking") return OPEN[latest?.trigger ?? ""] ?? "reading";
  if (state === "waiting") return "tray";
  if (state === "done") return "approved";
  if (state === "blocked") return "failed";
  if (state === "drafting") return id === "keeper" ? "note" : "fix";
  if (state === "watching") return WATCHES[id] ?? "watchShop";
  if (state === "walking") return "walking";
  return ENDED[latest?.outcome ?? ""] ?? "idle";
}
