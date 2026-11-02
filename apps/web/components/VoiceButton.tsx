"use client";

import { HERO } from "../lib/i18n-hero";
import { useAsk } from "./AskProvider";
import { Button } from "./Button";
import { useLang } from "./LangProvider";
import { LevelBars, MicIcon } from "./MicButton";
import "./VoiceButton.css";

/**
 * "Ask by voice", in the page's language (Devanagari only in Hindi): the same recorder as the mic in the bar. Tap to listen (the
 * question opens on /ask), tap again to ask; while it listens it shows the voice's level and says so.
 */
export function VoiceButton() {
  const { lang, t } = useLang();
  const h = HERO[lang];
  const { voice, level, toggleVoice } = useAsk();
  const listening = voice === "listening";
  return (
    <div className="ask">
      <Button className={`press-ask${listening ? " is-listening" : ""}`} aria-pressed={listening} disabled={voice === "asking"} onClick={toggleVoice}>
        {listening ? <LevelBars level={level} /> : <MicIcon size={22} />}
        {voice === "idle" ? (
          <span lang={lang}>{lang === "hi" ? t.askHi : t.askEn}</span>
        ) : (
          <span>{listening ? h.micListening : h.micAsking}</span>
        )}
      </Button>
    </div>
  );
}
