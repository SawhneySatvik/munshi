"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { askAction } from "../app/ask/actions";
import { savedTurns } from "../lib/ask-turn";
import { type AskError, type AskTurn, MAX_RECORDING_MS } from "../lib/hero-types";
import { encodeWav, resample, VOICE_RATE } from "../lib/wav";

export type Voice = "idle" | "listening" | "asking";
export type Notice = AskError | "denied" | "none" | "short" | "failed";

type AskState = {
  turns: AskTurn[];
  voice: Voice;
  /** The microphone's loudness while listening, 0–1, for the level bars. */
  level: number;
  /** A typed question or a sent recording is with the server. */
  busy: boolean;
  notice: Notice | null;
  toggleVoice: () => void;
  send: (form: FormData) => Promise<void>;
  dismiss: () => void;
};

const AskContext = createContext<AskState | null>(null);
// Under this many seconds a recording holds no question worth sending.
const SHORTEST_S = 0.4;

/**
 * The asking side of the app, held in the layout so it survives moving between pages: this session's questions and
 * answers (kept in the tab's sessionStorage for the signed-in member; a reload of a new tab starts empty), and the one
 * microphone recorder. Tapping a mic starts recording (inside the tap, as browsers require) and opens /ask; tapping again
 * stops, encodes 16 kHz mono 16-bit WAV, and sends it to the ask action, whose answer joins the history.
 */
export function AskProvider({ who, children }: { who: string; children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [voice, setVoice] = useState<Voice>("idle");
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const rec = useRef<{ ctx: AudioContext; stream: MediaStream | null; node: ScriptProcessorNode | null; chunks: Float32Array[]; timer: number } | null>(null);
  const key = `munshi_asks:${who}`;

  useEffect(() => {
    try {
      setTurns(savedTurns(sessionStorage.getItem(key)));
    } catch {
      // storage blocked: start with no history
    }
  }, [key]);

  const keep = (next: AskTurn[]) => {
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      // storage full or blocked: the history still shows until a reload
    }
  };

  const send = async (form: FormData) => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await askAction(null, form);
      if (r && "turn" in r) {
        setTurns((was) => {
          const next = [r.turn, ...was];
          keep(next);
          return next;
        });
      } else setNotice(r?.error ?? "failed");
    } catch {
      setNotice("failed");
    } finally {
      setBusy(false);
    }
  };

  const release = () => {
    const r = rec.current;
    rec.current = null;
    if (!r) return null;
    window.clearTimeout(r.timer);
    r.node?.disconnect();
    for (const t of r.stream?.getTracks() ?? []) t.stop();
    void r.ctx.close();
    setLevel(0);
    return r;
  };

  const stop = async () => {
    const r = release();
    if (!r) return;
    const all = new Float32Array(r.chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of r.chunks) {
      all.set(c, at);
      at += c.length;
    }
    if (all.length < r.ctx.sampleRate * SHORTEST_S) {
      setVoice("idle");
      setNotice("short");
      return;
    }
    const wav = encodeWav(resample(all, r.ctx.sampleRate, VOICE_RATE));
    const form = new FormData();
    form.append("audio", new Blob([wav as BlobPart], { type: "audio/wav" }), "question.wav");
    setVoice("asking");
    await send(form);
    setVoice("idle");
  };

  const start = async () => {
    setNotice(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      setNotice("none");
      return;
    }
    // Made inside the tap, before any await: a context made later may stay suspended.
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: VOICE_RATE });
    } catch {
      ctx = new AudioContext();
    }
    rec.current = { ctx, stream: null, node: null, chunks: [], timer: 0 };
    setVoice("listening");
    if (path !== "/ask") router.push("/ask");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      release();
      setVoice("idle");
      const name = (err as { name?: string })?.name;
      setNotice(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "none");
      return;
    }
    const r = rec.current;
    if (!r) {
      for (const t of stream.getTracks()) t.stop(); // stopped while the permission prompt was up
      return;
    }
    await ctx.resume();
    const node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      r.chunks.push(new Float32Array(d));
      let sum = 0;
      for (let i = 0; i < d.length; i++) sum += (d[i] as number) ** 2;
      setLevel(Math.min(1, Math.sqrt(sum / d.length) * 6));
    };
    ctx.createMediaStreamSource(stream).connect(node);
    node.connect(ctx.destination); // a processor runs only while connected; it writes silence
    r.stream = stream;
    r.node = node;
    r.timer = window.setTimeout(() => void stop(), MAX_RECORDING_MS);
  };

  const toggleVoice = () => {
    if (voice === "listening") void stop();
    else if (voice === "idle" && !busy) void start();
  };

  return (
    <AskContext value={{ turns, voice, level, busy, notice, toggleVoice, send, dismiss: () => setNotice(null) }}>{children}</AskContext>
  );
}

export function useAsk(): AskState {
  const state = useContext(AskContext);
  if (!state) throw new Error("useAsk needs an AskProvider above it");
  return state;
}
