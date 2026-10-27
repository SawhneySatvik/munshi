"use client";

import type { ReactNode } from "react";
import { OPS } from "../lib/i18n-ops";
import type { Stamped } from "../lib/ops-types";
import { clock } from "../lib/time";
import { useLang } from "./LangProvider";
import { Stamp } from "./Stamp";

/** A write the books took: the stamp, who and when from its audit entry, and what it changed (each figure a cell). */
export function Recorded({ stamp, children }: { stamp: Stamped | null; children: ReactNode }) {
  const { lang } = useLang();
  return (
    <div className="recorded">
      {stamp && <Stamp tone="approved">{OPS[lang].recorded}</Stamp>}
      <div className="recorded-what">
        {stamp && (
          <p className="by">
            <span data-name="">{stamp.by}</span> · <time dateTime={stamp.at}>{clock(stamp.at, lang)}</time>
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
