"use client";

import { useId, useState } from "react";
import { fill } from "../lib/i18n";
import type { Finding } from "../lib/types";
import { useLang } from "./LangProvider";
import { LedgerCard } from "./LedgerCard";
import "./MoreFindings.css";

/**
 * The findings below the brief's top few, behind a "+N more" row that opens them in place under it. N is a count of rows on
 * the page (the same kind of layout counter as the row numbers), not a ledger figure; every figure inside stays a Figure.
 */
export function MoreFindings({ findings, first }: { findings: Finding[]; first: number }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const list = useId();
  if (!findings.length) return null;
  return (
    <section className="more" aria-label={t.briefHeading}>
      <button type="button" className="press more-btn" aria-expanded={open} aria-controls={list} onClick={() => setOpen(!open)}>
        {open ? t.fewerFindings : fill(t.moreFindings, { n: <span className="seq">+{findings.length}</span> })}
      </button>
      {open && (
        <div id={list}>
          <LedgerCard findings={findings} first={first} />
        </div>
      )}
    </section>
  );
}
