// One message in a shop's staff group, answered. The chat relay (apps/teammate) hands in who the chat platform says
// sent it; everything else is the app's own flows, run as that person: Ask, the brief's findings, Draft the fix and
// core's decide(). The account is known only through a link its member made signed in (core's chatSession), so an
// unlinked account reads nothing. Nothing here decides who may do what: the database refuses a member who may not
// approve a draft, whatever the chat says.
//
// A chat message is a screen. Every figure comes from a stored cell through the screens' own resolver, and each cites
// its source; the agent's words carry no digits of their own. An id's tail is a label, not a figure. Replies are plain
// text with no angle brackets, because a chat bridge may read them as markup.
import "server-only";
import { chatSession, CoreError, decide, linkChat, REASONS, type ReasonCode, type Session, waitingDraftByTail } from "@munshi/core";
import type { AnswerPart } from "../hero-types";
import { keyRef, resolveNumber } from "../snapshot";
import type { Finding, OwnerHome, Snapshot, SourceRef } from "../types";
import { appPool } from "./db";
import { askBooks, fixFindings } from "./hero";
import { loadHome } from "./home";
import { flushOutbox } from "./outbox.ts";

export type ChatTurn = { channel: string; sender: string; text: string };

export type Said =
  | { kind: "link"; code: string }
  | { kind: "help" }
  | { kind: "brief" }
  | { kind: "drafts" }
  | { kind: "fix"; tail: string }
  | { kind: "approve"; tail: string }
  | { kind: "reject"; tail: string; reason: ReasonCode | null }
  | { kind: "ask"; question: string };

const TAIL = "([0-9a-f]{6})";

/** What a message asks for. Anything that is not a command is a question for the books. */
export function parseTurn(text: string): Said {
  const words = text.replace(/(^|\s)@[\w.-]+/g, " ").replace(/\s+/g, " ").trim();
  const lower = words.toLowerCase();
  const link = /^link (.+)$/i.exec(words);
  if (link) return { kind: "link", code: link[1] as string };
  if (lower === "" || lower === "help") return { kind: "help" };
  if (lower === "brief") return { kind: "brief" };
  if (lower === "drafts") return { kind: "drafts" };
  const fix = new RegExp(`^fix ${TAIL}$`).exec(lower);
  if (fix) return { kind: "fix", tail: fix[1] as string };
  const approve = new RegExp(`^approve ${TAIL}$`).exec(lower);
  if (approve) return { kind: "approve", tail: approve[1] as string };
  const reject = new RegExp(`^reject ${TAIL}(?: (.+))?$`).exec(lower);
  if (reject) {
    const reason = (REASONS as readonly string[]).find((r) => r === reject[2]?.replace(/ /g, "_"));
    return { kind: "reject", tail: reject[1] as string, reason: (reason as ReasonCode | undefined) ?? null };
  }
  return { kind: "ask", question: words };
}

const tailOf = (id: string) => id.slice(-6);

const NOT_LINKED = "I don't know this account yet. Open Munshi, go to Chat link, and post the code here as: link XXXX-XXXX";
const HELP = [
  "Ask me anything about the books, or:",
  "brief: what is leaking today",
  "fix CODE: draft the fix for a finding",
  "drafts: what is waiting for a decision",
  "approve CODE",
  `reject CODE REASON, the reason one of: ${REASONS.join(", ")}`,
].join("\n");

const COMMAND: Record<string, string> = {
  "reorder.place": "the reorder",
  "customer.remind": "the reminder",
  "package.expire": "the package lapse",
  "message.reply": "the reply",
  "surplus.give": "the gift",
  "paypal.request": "the payment link",
  "stock.count": "the stock count",
  "purchase.record": "the bill",
};
const commandLabel = (command: string) => COMMAND[command] ?? "this draft";
const capital = (words: string) => words.replace(/^./, (c) => c.toUpperCase());

// A figure with its source, numbered for the footer: `₹2,350 [1]`. Figures from one row of one snapshot share a number.
// Two snapshots can share a label, so a source is its snapshot's row, never its words.
class Cited {
  private sources = new Map<string, string>();
  constructor(private snapshots: Snapshot[]) {}
  figure(ref: SourceRef): string {
    const shown = resolveNumber(this.snapshots, ref);
    if (shown === null) return "Cannot verify";
    const key = `${ref.snapshotId}:${ref.row}`;
    if (!this.sources.has(key)) this.sources.set(key, `${ref.label.en}, row ${ref.row}`);
    return `${shown} [${[...this.sources.keys()].indexOf(key) + 1}]`;
  }
  footer(): string {
    return this.sources.size ? `\n\n${[...this.sources.values()].map((s, i) => `[${i + 1}] ${s}`).join("\n")}` : "";
  }
}

const FINDING: Record<Finding["kind"], string> = {
  shelf_gap: "Shelf and books disagree",
  price_rise: "A supplier raised a price",
  overdue_credit: "Credit is overdue",
  expiry: "Stock is near its expiry",
  short_settlement: "A settlement came in short",
};

function briefOf(home: OwnerHome): string {
  if (!home.findings.length) return "Nothing is leaking in the last brief.";
  const cited = new Cited(home.snapshots);
  const lines = home.findings.map((f) => {
    const what = "item" in f ? `${FINDING[f.kind]}: ${f.item}` : FINDING[f.kind];
    const move = f.fix ? ` (fix ${tailOf(f.id)})` : "";
    const figures = f.kind === "shelf_gap" ? `books ${cited.figure(f.books)}, shelf ${cited.figure(f.shelf)}` : cited.figure(keyRef(f));
    return `- ${what}, ${figures}${move}`;
  });
  return `${lines.join("\n")}${cited.footer()}`;
}

/** Each draft waiting (`only`: just these), with what it would do and how to decide it; a figure only from the cell it cites. */
function draftsOf(home: OwnerHome, only?: string[]): string | null {
  const cited = new Cited(home.snapshots);
  const wanted = (d: { id: string; status: string }) => d.status === "proposed" && (!only || only.includes(d.id));
  const decide = (id: string) => `To decide: approve ${tailOf(id)}, or reject ${tailOf(id)} not_now`;
  const reorders = home.drafts.filter(wanted).map((d) => {
    const lines = d.lines.map((l) => `${l.item}, ${l.qty ? cited.figure(l.qty) : "Cannot verify"}`).join("; ");
    return `Reorder from ${d.supplier.name}${d.supplier.simulated ? " (simulated supplier)" : ""}: ${lines}.\n${decide(d.id)}`;
  });
  const tray = (home.tray ?? []).filter(wanted).map((d) => {
    const who = d.customer ? ` to ${d.customer}` : "";
    const figure = d.figure ? `, ${cited.figure(d.figure)}` : "";
    return `${capital(commandLabel(d.command).replace(/^the /, ""))}${who}${figure}.\n${decide(d.id)}`;
  });
  const cards = [...reorders, ...tray];
  return cards.length ? `${cards.join("\n\n")}${cited.footer()}` : null;
}

function answerOf(parts: AnswerPart[], cited: Cited): string {
  return parts
    .map((p) => {
      if (p.t === "text" || p.t === "name") return p.v;
      if (p.t === "ref") return cited.figure(p.ref);
      return "Cannot verify";
    })
    .join("");
}

async function ask(session: Session, question: string): Promise<string> {
  const turn = await askBooks(session, { via: "text", question });
  if (turn.reply.kind === "abstain") return `Cannot verify. Missing: ${turn.reply.missing.join(", ")}.`;
  const cited = new Cited(turn.snapshots);
  const words = turn.reply.segments.map((s) => answerOf(s, cited)).join(" ");
  return `${words}${cited.footer()}`;
}

async function fix(session: Session, tail: string): Promise<string> {
  const home = await loadHome(session);
  const finding = home.findings.find((f) => tailOf(f.id) === tail);
  if (!finding?.fix) return `No finding ${tail} has a fix you can draft.`;
  const outcomes = await fixFindings(session, finding.ids ?? [finding.id]);
  const made = outcomes.flatMap((o) => (o.kind === "proposed" ? [o.draftId] : []));
  if (!made.length) return "No fix came of that: the finding has moved on, or a draft is already waiting.";
  const cards = draftsOf(await loadHome(session), made);
  return `Drafted. Nothing changes until someone who may approve it says so.${cards ? `\n\n${cards}` : ""}`;
}

async function decideTurn(session: Session, tail: string, verdict: "approved" | "rejected", reason?: ReasonCode): Promise<string> {
  const pool = await appPool();
  const draft = await waitingDraftByTail(pool, session, tail);
  if (!draft) return `No draft ${tail} is waiting.`;
  const { member } = await loadHome(session);
  const what = commandLabel(draft.command);
  try {
    const d = await decide(pool, session, draft.id, verdict, reason);
    if (d.status === "stale") return `The books moved since ${what} was drafted, so it was not applied. Nothing changed.`;
    if (d.status === "rejected") return `Rejected by ${member.name} (${member.role}): ${reason?.replace(/_/g, " ")}. Nothing changed. Decision ${tailOf(d.decisionId)}.`;
    await flushOutbox();
    return `Approved by ${member.name} (${member.role}). ${capital(what)} is done, in the books under their name. Decision ${tailOf(d.decisionId)}.`;
  } catch (err) {
    if (err instanceof CoreError && err.code === "refused") return `${member.name}, your role can't decide ${what}, and the database refused it. It's still waiting.`;
    if (err instanceof CoreError && err.code === "not_proposed") return `${capital(what)} has already been decided.`;
    throw err;
  }
}

async function reply(session: Session, said: Exclude<Said, { kind: "link" }>): Promise<string> {
  switch (said.kind) {
    case "help":
      return HELP;
    case "brief":
      return briefOf(await loadHome(session));
    case "drafts":
      return draftsOf(await loadHome(session)) ?? "Nothing is waiting for a decision.";
    case "fix":
      return fix(session, said.tail);
    case "approve":
      return decideTurn(session, said.tail, "approved");
    case "reject":
      if (!said.reason) return `Say why, as: reject ${said.tail} not_now. The reasons are: ${REASONS.join(", ")}`;
      return decideTurn(session, said.tail, "rejected", said.reason);
    case "ask":
      return ask(session, said.question);
  }
}

/** The reply to one message: from a linked account, as that member; otherwise only a link is taken. */
export async function answerTurn(tenantId: string, turn: ChatTurn): Promise<string> {
  const pool = await appPool();
  const said = parseTurn(turn.text);
  if (said.kind === "link") {
    const linked = await linkChat(pool, tenantId, turn.channel, turn.sender, said.code);
    if (!linked) return "That code didn't work. It may be used or expired, or this account may already be linked. Get a new one in Munshi, under Chat link.";
    const session = await chatSession(pool, tenantId, turn.channel, turn.sender);
    const { member } = await loadHome(session as Session);
    return `Linked. This account is now ${member.name} (${member.role}) here.`;
  }
  const session = await chatSession(pool, tenantId, turn.channel, turn.sender);
  if (!session) return NOT_LINKED;
  const text = await reply(session, said);
  return session.via === "real" ? text : `${text}\n\nSample shop: synthetic data, simulated suppliers.`;
}
