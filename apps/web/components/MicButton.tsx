"use client";

import { usePathname } from "next/navigation";
import { HERO } from "../lib/i18n-hero";
import { noticeText } from "../lib/hero-words";
import { useAsk } from "./AskProvider";
import { useLang } from "./LangProvider";
import "./MicButton.css";

export function MicIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8.5" y="2.5" width="7" height="12" rx="3.5" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7" />
    </svg>
  );
}

/** The microphone's loudness as five bars: what the person sees while it listens (no figure, no timer). */
export function LevelBars({ level }: { level: number }) {
  return (
    <span className="bars" aria-hidden="true">
      {[0.55, 0.85, 1, 0.8, 0.5].map((k, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: five fixed bars.
        <span key={i} style={{ transform: `scaleY(${Math.max(0.18, Math.min(1, level * k * 1.6))})` }} />
      ))}
    </span>
  );
}

/**
 * The raised turmeric mic in the middle of the bottom bar, heading the rail on a desk. Tap to listen, tap again
 * to ask: the recording goes to the ask action and the answer opens on /ask. What it is doing shows in a bubble over
 * the bar (a live region), and so does anything that stopped it: no microphone, no permission, too short. On /ask the
 * composer carries that instead.
 */
export function MicButton() {
  const { lang, t } = useLang();
  const h = HERO[lang];
  const { voice, level, notice, toggleVoice, dismiss } = useAsk();
  // On /ask the composer says all this itself, beside the history it lands in.
  const here = usePathname() === "/ask";
  const say = here ? null : voice === "listening" ? h.micListening : voice === "asking" ? h.micAsking : notice ? noticeText(notice, lang) : null;
  return (
    <li className="nav-mic">
      <button
        type="button"
        className={`mic is-${voice}`}
        aria-label={voice === "listening" ? h.micStop : h.micStart}
        aria-pressed={voice === "listening"}
        disabled={voice === "asking"}
        onClick={toggleVoice}
      >
        <span className="mic-disc">
          <MicIcon />
        </span>
        <span className="mic-label" aria-hidden="true">
          {h.navAsk}
        </span>
      </button>
      <div className="mic-say" role="status">
        {say && (
          <p className={notice && voice === "idle" ? "is-notice" : undefined}>
            {voice === "listening" && <LevelBars level={level} />}
            <span>{say}</span>
            {notice && voice === "idle" && (
              <button type="button" className="mic-x" onClick={dismiss}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
                <span className="vh">{t.close}</span>
              </button>
            )}
          </p>
        )}
      </div>
    </li>
  );
}
