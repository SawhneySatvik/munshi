"use client";

// The light/dark switch of a look that has both (D-047). The site opens in the phone's mode; a choice is kept in this
// browser only (a per-viewer convenience), and the page renders either way without it.
import { useEffect, useState } from "react";
import type { Lang } from "../lib/business.ts";

const LABEL = { light: { en: "Switch to dark mode", hi: "डार्क मोड चुनें" }, dark: { en: "Switch to light mode", hi: "लाइट मोड चुनें" } };

export function ModeToggle({ lang }: { lang: Lang }) {
  const [mode, setMode] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("site.mode");
    } catch {
      // storage refused: follow the phone
    }
    const initial = saved === "light" || saved === "dark" ? saved : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.mode = initial;
    setMode(initial);
  }, []);
  const flip = () => {
    const next = mode === "dark" ? "light" : "dark";
    document.documentElement.dataset.mode = next;
    try {
      localStorage.setItem("site.mode", next);
    } catch {
      // not kept: the switch still works for this page
    }
    setMode(next);
  };
  const shown = mode ?? "dark";
  return (
    <button type="button" className="mode" aria-label={LABEL[shown][lang]} onClick={flip} data-mode-toggle="">
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        {shown === "dark" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
          </>
        ) : (
          <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
}
