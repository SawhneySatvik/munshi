"use client";

import { Button } from "./Button";
import { useLang } from "./LangProvider";
import "./VoiceButton.css";

/** "बोलकर पूछें · Ask by voice", in both languages always. Docked to the bottom on a phone. Not wired to voice yet. */
export function VoiceButton() {
  const { t } = useLang();
  return (
    <div className="ask">
      <Button className="press-ask">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="8.5" y="2.5" width="7" height="12" rx="3.5" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7" />
        </svg>
        <span>
          <span className="ask-hi" lang="hi">
            {t.askHi}
          </span>{" "}
          · <span lang="en">{t.askEn}</span>
        </span>
      </Button>
    </div>
  );
}
