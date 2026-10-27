"use client";

import { resolveNumber } from "../lib/snapshot";
import type { SourceRef } from "../lib/types";
import { CannotVerify } from "./CannotVerify";
import { useLang } from "./LangProvider";
import { RedRing } from "./RedRing";
import { SourceChip } from "./SourceChip";
import { useRing, useSources } from "./Sources";

/** A figure on a card. It takes a ref, never a number: the digits come from the snapshot cell or are not shown at all. */
export function Cell({ sourceRef }: { sourceRef: SourceRef }) {
  const { snapshots } = useSources();
  const { lang } = useLang();
  const ring = useRing(sourceRef);
  const value = resolveNumber(snapshots, sourceRef, lang);
  if (value === null) return <CannotVerify />;
  return (
    <SourceChip sourceRef={sourceRef}>
      <RedRing on={ring.on} desk={ring.desk}>
        <span className="amt">{value}</span>
      </RedRing>
    </SourceChip>
  );
}
