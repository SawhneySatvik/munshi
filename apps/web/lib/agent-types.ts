// What an agent move's server action answers the screen (W1-A): a finding's "Why?" (an Ask turn), or a fixed note from
// i18n-agents.ts, never model text. `ok` says whether the move did what was asked (a draft made, a note heard).
import type { AskTurn } from "./hero-types";
import type { AgentsDict } from "./i18n-agents";

export type AgentNote = keyof AgentsDict;
export type AgentState = { turn: AskTurn } | { note: AgentNote; ok: boolean } | null;
