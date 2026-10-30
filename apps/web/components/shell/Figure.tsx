"use client";

import { answerValue } from "../../lib/hero-words";
import { resolveCell, resolveNumber, resolvePercent } from "../../lib/snapshot";
import type { SourceRef } from "../../lib/types";
import { CannotVerify } from "../CannotVerify";
import { useLang } from "../LangProvider";
import { RedRing } from "../RedRing";
import { DRAWER_ID, useRing, useSources } from "../Sources";
import "./Figure.css";

type Props = {
  /** The stored snapshot cell the figure shows. Never a number or a string of digits (test/figure.types.tsx holds it):
   *  the digits come from the cell, or the figure reads "Cannot verify". null is a figure with no source. */
  cell: SourceRef | null;
  /** How the cell is worded: as a card shows it ("24"), as an answer does, with its unit ("24 packs"), or a basis-points
   *  cell as a percentage ("10%"). */
  read?: "card" | "answer" | "percent";
  /** A figure in a ledger table: the table's own source line names the source once, for every figure under it. */
  table?: boolean;
  children?: never;
};

/**
 * A traceable figure (BLUEPRINT §9.2): the cell's value with a faint dotted underline, as one button. Tapping it opens
 * the source drawer at the exact snapshot row, the cell highlighted; its accessible name says where the number comes
 * from ("₹2,350, source: Credit book"). A ref that does not land on a figure cell renders "Cannot verify".
 */
export function Figure({ cell, read = "card", table = false }: Props) {
  const { snapshots, open } = useSources();
  const { lang, t } = useLang();
  const ring = useRing(cell ?? NO_REF);
  const value =
    cell &&
    (read === "answer" ? answerValue(resolveCell(snapshots, cell), lang) : read === "percent" ? resolvePercent(snapshots, cell) : resolveNumber(snapshots, cell, lang));
  if (!cell || value === null) return <CannotVerify />;
  return (
    <button type="button" className={`pair fig${table ? " bk-fig" : ""}`} aria-controls={DRAWER_ID} onClick={(e) => open(cell, e.currentTarget)}>
      <span className="pair-in">
        <RedRing on={ring.on} desk={ring.desk}>
          <span className="amt">{value}</span>
        </RedRing>
        <span className="vh">
          , {t.source}: <span className="ref">{cell.label[lang]}</span>
        </span>
      </span>
    </button>
  );
}

// useRing is a hook, so it runs for a null cell too; this ref matches no snapshot.
const NO_REF: SourceRef = { label: { en: "", hi: "" }, snapshotId: "", row: 0, col: "" };
