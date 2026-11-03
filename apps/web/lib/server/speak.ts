// Read aloud (server only). The client names only WHAT to read: an Ask answer by its run's id, or a morning brief
// by its id, and the page's language. Never words: the text is loaded here, as the screen would show it, from what was
// already checked and stored. An answer is the asking member's own stored ai.answer (answers.ts), each segment through
// hero.ts's partsOf (a segment that fails its check is "Cannot verify", never the model's words), each figure the
// rendered cell; a brief is the one the office shows this member, each line its narrated words or its fixed line, each
// figure the cell the office renders. Only then does a speak run start: an id that names nothing this member can see
// starts no run and spends no call. The speech model voices the text and writes nothing; the run writes only its own
// row, its traces and the calls core counts (media, under the shop's caps).
import { type CheckedSegment, readAloud } from "@munshi/agent";
import type { SpeakLanguage } from "@munshi/ai";
import { type Cell, ownAskAnswer, resolveRef, type Session, storedSnapshots } from "@munshi/core";
import { answerValue } from "../hero-words";
import { DICT } from "../i18n";
import { BRIEF_LINE } from "../i18n-app";
import { resolveCell, resolveNumber } from "../snapshot";
import type { Lang, Snapshot, SourceRef } from "../types";
import { agentDeps, endRun, recordedMode, startRun, switchedOff } from "./agent-port";
import { partsOf } from "./hero";
import { cellValue, named, page } from "./ledger";
import { briefIn } from "./office";

export type SpeakTarget = { kind: "answer"; id: string } | { kind: "brief"; id: string };
export type SpeakOutcome = { audio: string; mime: "audio/mpeg" | "audio/wav"; recorded: boolean } | { error: "not_found" | "off" | "no_key" | "model_error" };

const VOICE: Record<Lang, SpeakLanguage> = { en: "en-IN", hi: "hi-IN" };
// The brief's own placeholder and its reading, as the office screen has them (OfficeViews.tsx Words).
const HANDLE = /⟦(\d+)⟧/g;
const handleIndex = (n: string) => (Number(n) || 1) - 1;

// The voice for words: the language of the first Indian script they are written in (an answer is in its question's
// language, a Tamil question's answer in Tamil), else the page's. Devanagari is read as Hindi.
const SCRIPTS: [RegExp, SpeakLanguage][] = [
  [/\p{Script=Devanagari}/u, "hi-IN"],
  [/\p{Script=Bengali}/u, "bn-IN"],
  [/\p{Script=Gujarati}/u, "gu-IN"],
  [/\p{Script=Gurmukhi}/u, "pa-IN"],
  [/\p{Script=Kannada}/u, "kn-IN"],
  [/\p{Script=Malayalam}/u, "ml-IN"],
  [/\p{Script=Oriya}/u, "od-IN"],
  [/\p{Script=Tamil}/u, "ta-IN"],
  [/\p{Script=Telugu}/u, "te-IN"],
];
export function voiceFor(text: string, lang: Lang): SpeakLanguage {
  let first: [number, SpeakLanguage] | null = null;
  for (const [script, code] of SCRIPTS) {
    const at = text.search(script);
    if (at >= 0 && (!first || at < first[0])) first = [at, code];
  }
  return first ? first[1] : VOICE[lang];
}

// Stored snapshots as the screen holds them (rows of CellValue, a person's name beside their id).
const asShown = (stored: Awaited<ReturnType<typeof storedSnapshots>>): Snapshot[] =>
  stored.map((s) => ({
    id: s.id,
    query: s.query,
    readAt: s.readAt,
    title: { en: s.query, hi: s.query },
    columns: [],
    rows: s.rows.map((row) => named(Object.fromEntries(Object.entries(row).map(([col, c]) => [col, cellValue(c)])), s.names)),
  }));

/** The asking member's stored answer for an Ask run, in words as the turn shows them; null if there is none to read. */
async function answerText(session: Session, runId: string, lang: Lang): Promise<string | null> {
  return page(session, async (c) => {
    const found = await ownAskAnswer(c, session.memberId, runId);
    if (!found) return null;
    const words = found.words;
    const snapshots = asShown(await storedSnapshots(c, found.refs.flat().map((r) => r.snapshotId)));
    const said: string[] = [];
    for (const [i, refs] of found.refs.entries()) {
      const cells: Cell[] = [];
      for (const ref of refs) cells.push((await resolveRef(c, ref)) ?? { kind: "null" });
      const seg = { text: words[i] ?? "", refs, cells } as CheckedSegment;
      said.push(
        partsOf(seg, snapshots)
          .map((p) => (p.t === "text" || p.t === "name" ? p.v : p.t === "ref" ? (answerValue(resolveCell(snapshots, p.ref), lang) ?? DICT[lang].cannotVerify) : DICT[lang].cannotVerify))
          .join(""),
      );
    }
    return said.join(" ");
  });
}

/** The morning brief the office shows this member, line by line in words; null if it shows them no such brief. */
async function briefText(session: Session, briefId: string, lang: Lang): Promise<string | null> {
  return page(session, async (c) => {
    const data = await briefIn(c, session);
    // The brief is the office's (core's map): core's viewBrief reads none for another role (mayReadIn), so
    // nothing of it is found to read aloud.
    const brief = data.briefs.find((b) => b.id === briefId);
    if (!brief) return null;
    const fig = (ref: SourceRef | undefined) => (ref ? resolveNumber(data.snapshots, ref, lang) : null) ?? DICT[lang].cannotVerify;
    const lines = brief.lines.map((l) => {
      const fixed = BRIEF_LINE[l.kind]?.[lang];
      if (!l.narrated && fixed) return fixed.replace(/\{fig\}/g, () => fig(l.refs[0]));
      return l.text.replace(HANDLE, (_, n: string) => fig(l.refs[handleIndex(n)]));
    });
    return lines.filter((t) => t.trim()).join(" ");
  });
}

/** The words Read aloud voices for a target, as this member's screen shows them; null when it names nothing to read. */
export async function spokenText(session: Session, target: SpeakTarget, lang: Lang): Promise<string | null> {
  const text = target.kind === "answer" ? await answerText(session, target.id, lang) : await briefText(session, target.id, lang);
  return text?.trim() ? text : null;
}

/** Reads a checked answer or the brief aloud for the signed-in member: its words in the page's language, in their voice. */
export async function speakChecked(session: Session, target: SpeakTarget, lang: Lang): Promise<SpeakOutcome> {
  // Read aloud switched off for the shop by the operator: refused as off, before any run (startRun refuses it too).
  if (await switchedOff(session, "read_aloud")) return { error: "off" };
  const text = await spokenText(session, target, lang);
  if (!text) return { error: "not_found" };
  const run = await startRun(session, "speak");
  try {
    const r = await readAloud(text, { port: run.port, language: voiceFor(text, lang), deps: run.deps(agentDeps("speak"), "speak") });
    if (r.kind === "refused") return { error: r.why };
    return { audio: Buffer.from(r.audio).toString("base64"), mime: r.mime, recorded: recordedMode() };
  } finally {
    await endRun(run);
  }
}
