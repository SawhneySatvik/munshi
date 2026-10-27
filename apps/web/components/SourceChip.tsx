"use client";

import type { ReactNode } from "react";
import type { SourceRef } from "../lib/types";
import { useLang } from "./LangProvider";
import { DRAWER_ID, useSources } from "./Sources";
import "./SourceChip.css";

/**
 * A number and the plain name of where it came from ("Stock ledger"), as one button: tapping it opens the source drawer
 * at the exact snapshot row, cell highlighted. Its accessible name reads "24, source: Stock ledger".
 */
export function SourceChip({ sourceRef, children }: { sourceRef: SourceRef; children: ReactNode }) {
  const { lang, t } = useLang();
  const { open } = useSources();
  return (
    <button type="button" className="pair" aria-controls={DRAWER_ID} onClick={(e) => open(sourceRef, e.currentTarget)}>
      <span className="pair-in">
        {children}
        <span className="vh">, {t.source}: </span> <span className="ref">{sourceRef.label[lang]}</span>
      </span>
    </button>
  );
}
