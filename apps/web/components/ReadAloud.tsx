"use client";

import { useEffect, useRef, useState } from "react";
import { readAloudAction, type SpeakState } from "../app/app/speak/actions";
import { SPEAK, type SpeakDict } from "../lib/i18n-speak";
import { useFeatureOn } from "./AiFeatures";
import { Button } from "./Button";
import { useLang } from "./LangProvider";
import { Sticker } from "./Sticker";
import "./ReadAloud.css";

// A tiny silent WAV, made here: played inside the tap, it unlocks the audio element on phones (iOS plays later audio on
// an element only if it played during a tap; the server round trip ends the tap).
function silence(): string {
  const n = 8; // samples
  const b = new DataView(new ArrayBuffer(44 + n * 2));
  const tag = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) b.setUint8(at + i, s.charCodeAt(i));
  };
  tag(0, "RIFF");
  b.setUint32(4, 36 + n * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true);
  b.setUint16(22, 1, true);
  b.setUint32(24, 8000, true);
  b.setUint32(28, 16000, true);
  b.setUint16(32, 2, true);
  b.setUint16(34, 16, true);
  tag(36, "data");
  b.setUint32(40, n * 2, true);
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...new Uint8Array(b.buffer)))}`;
}

const ERROR: Record<string, keyof SpeakDict> = { not_found: "notFound", off: "off", no_key: "noKey" };

// The one clip playing in the app: a Read aloud that starts stops it first, so two never talk over each other.
let current: { stop: () => void } | null = null;

/**
 * Read aloud: a play / stop button for one checked thing on the screen, an Ask answer (its run's id) or a morning brief
 * (its id). Only the id and the page's language go to the server, which loads the checked words itself; the audio comes
 * back and plays here. The button's words switch (read ↔ stop), so it carries no pressed state. A reply that comes back
 * after the button is gone, or after another clip took over, is dropped unplayed. In recorded mode the clip is a
 * labelled stand-in.
 */
export function ReadAloud({ kind, id }: { kind: "answer" | "brief"; id: string }) {
  const { lang } = useLang();
  const s = SPEAK[lang];
  const readOn = useFeatureOn("read_aloud");
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [note, setNote] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  // Each start takes a ticket; stopping or unmounting moves it on, so an older request's reply is never played.
  const ticket = useRef(0);
  const self = useRef<{ stop: () => void; halt: () => void }>({ stop: () => {}, halt: () => {} });

  const release = () => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  };
  const halt = () => {
    ticket.current++;
    audio.current?.pause();
    release();
    if (current === self.current) current = null;
  };
  const stop = () => {
    halt();
    setState("idle");
  };
  self.current.stop = stop;
  self.current.halt = halt;
  useEffect(() => () => self.current.halt(), []);

  async function start() {
    current?.stop();
    current = self.current;
    const mine = ++ticket.current;
    const el = audio.current ?? new Audio();
    audio.current = el;
    el.src = silence();
    el.play().catch(() => {});
    setState("loading");
    setNote(null);
    const form = new FormData();
    form.set("kind", kind);
    form.set("id", id);
    form.set("lang", lang);
    let r: SpeakState;
    try {
      r = await readAloudAction(null, form);
    } catch {
      r = { error: "other" };
    }
    if (mine !== ticket.current) return; // stopped, replaced or unmounted meanwhile
    if (!r || "error" in r) {
      stop();
      setNote(s[(r && ERROR[r.error]) || "failed"]);
      return;
    }
    const bytes = Uint8Array.from(atob(r.audio), (ch) => ch.charCodeAt(0));
    release();
    url.current = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
    setRecorded(r.recorded);
    el.onended = stop;
    el.src = url.current;
    try {
      await el.play();
      if (mine === ticket.current) setState("playing");
    } catch {
      if (mine !== ticket.current) return;
      stop();
      setNote(s.noPlay);
    }
  }

  const label = kind === "answer" ? s.readAloudAnswer : s.readAloudBrief;
  // Read aloud switched off for the shop by the operator: no button.
  if (!readOn) return null;
  return (
    <span className="read-aloud" data-slot="read-aloud">
      <Button className={`press-read${state === "playing" ? " is-playing" : ""}`} disabled={state === "loading"} onClick={state === "playing" ? stop : start}>
        <SpeakerIcon on={state === "playing"} />
        <span>{state === "playing" ? s.stop : state === "loading" ? s.loading : label}</span>
      </Button>
      {recorded && <Sticker tone="yellow">{s.recorded}</Sticker>}
      <span className="read-aloud-note" role="status" aria-live="polite">
        {note}
      </span>
    </span>
  );
}


function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      {on ? <path d="M16 9v6M19.5 9v6" /> : <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />}
    </svg>
  );
}
