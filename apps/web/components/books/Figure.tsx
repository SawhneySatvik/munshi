"use client";

import { resolveNumber } from "../../lib/snapshot";
import type { SourceRef } from "../../lib/types";
import { CannotVerify } from "../CannotVerify";
import { useLang } from "../LangProvider";
import { RedRing } from "../RedRing";
import { DRAWER_ID, useRing, useSources } from "../Sources";
// The chip's own button styles (.pair, .ref): a page may show figures without any inline chip.
import "../SourceChip.css";

/**
 * A figure in a ledger table: the Cell of a table. It takes a ref, never a number, and is a button that opens the source
 * drawer at its row with the cell highlighted. The source's plain name rides in its accessible name ("₹4,560, source:
 * Purchase bills"); on screen the table's own source line names it once for every figure under it.
 */
export function Figure({ sourceRef }: { sourceRef: SourceRef }) {
  const { snapshots, open } = useSources();
  const { lang, t } = useLang();
  const ring = useRing(sourceRef);
  const value = resolveNumber(snapshots, sourceRef, lang);
  if (value === null) return <CannotVerify />;
  return (
    <button type="button" className="pair bk-fig" aria-controls={DRAWER_ID} onClick={(e) => open(sourceRef, e.currentTarget)}>
      <span className="pair-in">
        <RedRing on={ring.on} desk={ring.desk}>
          <span className="amt">{value}</span>
        </RedRing>
        <span className="vh">
          , {t.source}: {sourceRef.label[lang]}
        </span>
      </span>
    </button>
  );
}
