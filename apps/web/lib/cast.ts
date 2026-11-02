// The cast the screens show (D-078, docs/superpowers/specs/2026-11-02-agents-wave-design.md): seven names over the
// database's desks and run kinds, which keep their ids. One place turns a run or a finding's desk into a cast member.
import type { AgentId } from "../components/office/types";

export type CastId = AgentId;

/** The cast in the order the office seats them; the first, the lead, answers for anything nothing names. */
export const CAST: readonly CastId[] = ["munshi", "tally", "ledger", "dash", "echo", "bloom", "keeper"];

// A desk's cast member: the desks the router answers from, the watchers' desks, and the agent desks of ref.ai_agent.
export const BY_DESK: Record<string, CastId> = {
  ask: "munshi",
  brief: "munshi",
  watch: "munshi",
  stock: "tally",
  shelf: "tally",
  sales: "ledger",
  bills: "ledger",
  settlements: "ledger",
  staff: "ledger",
  counter: "dash",
  recipe: "dash",
  customers: "echo",
  orders: "echo",
  bookings: "echo",
  replies: "echo",
  chat_to_order: "echo",
  voice: "echo",
  inbox: "echo",
  packages: "bloom",
  campaigns: "bloom",
  memory: "keeper",
  speak: "munshi",
};

// A run's trigger when its desk names no one: who started that kind of work.
export const BY_TRIGGER: Record<string, CastId> = {
  question: "munshi",
  voice: "munshi",
  brief: "munshi",
  watcher: "munshi",
  photo: "tally",
  inbox: "echo",
  campaign: "bloom",
  recipe: "dash",
  speak: "munshi",
};

/** The cast member for a run (its desk first, then its trigger) or a finding's desk; Munshi when nothing names one. */
export function castOf(x: { desk?: string | null; trigger?: string | null }): CastId {
  return (x.desk && BY_DESK[x.desk]) || (x.trigger && BY_TRIGGER[x.trigger]) || "munshi";
}
