"use client";

import { type FormEvent, useMemo, useState } from "react";
import type { AnswerPart, AskTurn } from "../lib/hero-types";
import { answerValue, missingText, noticeText } from "../lib/hero-words";
import { fill, fillText } from "../lib/i18n";
import { HERO } from "../lib/i18n-hero";
import { resolveCell } from "../lib/snapshot";
import { clock } from "../lib/time";
import type { Member, Snapshot, SourceRef } from "../lib/types";
import { useAsk } from "./AskProvider";
import { Button } from "./Button";
import { CannotVerify } from "./CannotVerify";
import { Foot } from "./Foot";
import { useLang } from "./LangProvider";
import { PageHead } from "./PageHead";
import { RedRing } from "./RedRing";
import { SourceChip } from "./SourceChip";
import { SourceDrawer } from "./SourceDrawer";
import { SourcesProvider, useRing, useSources } from "./Sources";
import { Sticker } from "./Sticker";
import { VoiceButton } from "./VoiceButton";
import "./LedgerCard.css";
import "./Ops.css";
import "./Ask.css";

export type AskPage = { shop: string; member: Member; recorded: boolean; questions: string[] };

const DESK = { stock: "deskStock", sales: "deskSales", credit: "deskCredit" } as const;
const DEVANAGARI = /\p{Script=Devanagari}/u;
const langOf = (text: string) => (DEVANAGARI.test(text) ? "hi" : "en");

/**
 * Ask the books, typed or spoken, and this session's questions with their answers. An answer's figures are cells the
 * run minted, each a chip that opens its row; a sentence that failed its check, or an answer that abstained, says
 * "Cannot verify" and why, in fixed words. The person's own words (typed, or what the voice model heard) are shown as
 * theirs. In recorded mode the screen says so and offers the questions that have a recorded response.
 */
export function AskView({ data }: { data: AskPage }) {
  const { lang } = useLang();
  const h = HERO[lang];
  const { turns, voice, busy, notice, send } = useAsk();
  const [question, setQuestion] = useState("");
  const [recording, setRecording] = useState<File | null>(null);
  const snapshots = useMemo(() => [...new Map(turns.flatMap((t) => t.snapshots).map((s): [string, Snapshot] => [s.id, s])).values()], [turns]);

  const ask = async (text: string) => {
    const form = new FormData();
    form.set("question", text);
    await send(form);
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = question;
    await ask(text);
    setQuestion((now) => (now === text ? "" : now));
  };
  const sendRecording = async () => {
    if (!recording) return;
    const form = new FormData();
    form.set("audio", recording);
    await send(form);
  };
  // The voice button says when it listens; this line says what is with the server, or what stopped it.
  const say = voice === "asking" || busy ? h.askSending : notice ? noticeText(notice, lang) : null;

  return (
    <SourcesProvider snapshots={snapshots} deskRef={null}>
      <main className="wrap ops asking">
        <div className="ops-a">
          <PageHead
            id="ask-h"
            kicker={fill(h.askKicker, { shop: <span data-name="">{data.shop}</span> })}
            title={h.askTitle}
            lede={
              <>
                {h.askLede} <mark>{h.askMark}</mark>
              </>
            }
          />
          <section className="ops-sec asked" aria-labelledby="asked-h">
            <h2 id="asked-h" className="ops-h">
              {h.historyHeading}
            </h2>
            {turns.length ? (
              <ol className="turns">
                {turns.map((turn) => (
                  <li key={turn.id}>
                    <Turn turn={turn} />
                  </li>
                ))}
              </ol>
            ) : (
              <p className="finds empty-line">{h.historyEmpty}</p>
            )}
            <p className="field-note">{h.historyNote}</p>
          </section>
        </div>
        <div className="ops-b">
          <form className="sheet composer" aria-labelledby="q-label" onSubmit={submit}>
            <label id="q-label" htmlFor="question" className="composer-h">
              {h.askField}
            </label>
            <textarea
              id="question"
              name="question"
              className="input composer-q"
              rows={2}
              maxLength={500}
              value={question}
              placeholder={h.askHint}
              lang={langOf(question)}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <Button type="submit" variant="primary" disabled={busy || voice !== "idle"}>
              {busy && voice === "idle" ? h.askSending : h.askSend}
            </Button>
            <VoiceButton />
            <div className="composer-say" role="status">
              {say && <p className={notice && !busy && voice === "idle" ? "ops-error" : undefined}>{say}</p>}
            </div>
          </form>
          {data.recorded && (
            <section className="recorded-box" aria-labelledby="rec-h">
              <div className="recorded-top">
                <h2 id="rec-h" className="kicker">
                  {h.recordedMode}
                </h2>
                <Sticker tone="yellow">{h.recordedResponse}</Sticker>
              </div>
              <p>{h.recordedNote}</p>
              <ul className="tries">
                {data.questions.map((q) => (
                  <li key={q}>
                    <Button className="press-try" disabled={busy || voice !== "idle"} aria-label={fillText(h.tryThis, { q })} onClick={() => void ask(q)}>
                      <span lang={langOf(q)} data-said="">
                        {q}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="field">
                <label htmlFor="recording" className="kicker field-label">
                  {h.askOrRecording}
                </label>
                <input
                  id="recording"
                  type="file"
                  className="file"
                  accept=".wav,audio/wav,audio/x-wav"
                  aria-describedby="recording-note"
                  onChange={(e) => setRecording(e.target.files?.[0] ?? null)}
                />
                <p id="recording-note" className="field-note">
                  {h.askRecordingNote}
                </p>
                <Button disabled={!recording || busy || voice !== "idle"} onClick={() => void sendRecording()}>
                  {h.askRecordingSend}
                </Button>
              </div>
            </section>
          )}
          <SourceDrawer />
        </div>
      </main>
      <Foot shop={data.shop} member={data.member} />
    </SourcesProvider>
  );
}

/** A fixed reason as a sentence of its own after the "Cannot verify" tag. */
const sentence = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}${langOf(s) === "hi" ? "।" : "."}`;

function Turn({ turn }: { turn: AskTurn }) {
  const { lang } = useLang();
  const h = HERO[lang];
  const reply = turn.reply;
  return (
    <article className="turn">
      <div className="turn-said">
        <p className="turn-who">
          <span className="kicker">{turn.via === "voice" ? h.youSaid : h.youAsked}</span>
          <time dateTime={turn.at}>{clock(turn.at, lang)}</time>
        </p>
        {turn.words ? (
          <p className="turn-words">
            <q data-said="" lang={langOf(turn.words)}>
              {turn.words}
            </q>
          </p>
        ) : (
          <p className="turn-words is-none">{h.heardNothing}</p>
        )}
      </div>
      <div className="turn-reply">
        <div className="turn-top">
          {reply.kind === "answer" && <span className="kicker">{h[DESK[reply.desk as keyof typeof DESK] ?? "deskSales"]}</span>}
          {turn.recorded && reply.kind === "answer" && <Sticker tone="yellow">{h.recordedResponse}</Sticker>}
        </div>
        {reply.kind === "answer" ? (
          reply.segments.map((parts, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: an answer's sentences are fixed once it is shown.
            <p key={i} className="turn-line" lang={langOf(parts.map((p) => (p.t === "text" ? p.v : "")).join(""))}>
              {parts.map((part, k) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a sentence's parts are fixed.
                <Part key={k} part={part} />
              ))}
            </p>
          ))
        ) : (
          <CannotVerify>
            {sentence(missingText(reply.missing, lang))}
            {turn.recorded && reply.missing.includes("model_error") ? ` ${h.noRecordedFor}` : ""}
          </CannotVerify>
        )}
      </div>
    </article>
  );
}

function Part({ part }: { part: AnswerPart }) {
  const { lang } = useLang();
  switch (part.t) {
    case "text":
      return part.v;
    case "name":
      return <span data-name="">{part.v}</span>;
    case "ref":
      return <AnswerFigure sourceRef={part.ref} />;
    case "cannot":
      return (
        <>
          <CannotVerify /> <span className="turn-why">{HERO[lang].segmentUnchecked}</span>
        </>
      );
  }
}

/** A figure in an answer: the cell with its unit, as a chip that opens its row. Never a number from the model. */
function AnswerFigure({ sourceRef }: { sourceRef: SourceRef }) {
  const { snapshots } = useSources();
  const { lang } = useLang();
  const ring = useRing(sourceRef);
  const value = answerValue(resolveCell(snapshots, sourceRef), lang);
  if (value === null) return <CannotVerify />;
  return (
    <SourceChip sourceRef={sourceRef}>
      <RedRing on={ring.on} desk={ring.desk}>
        <span className="amt">{value}</span>
      </RedRing>
    </SourceChip>
  );
}
