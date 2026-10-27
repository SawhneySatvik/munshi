import type { ReactNode } from "react";
import "./RedRing.css";

/** The red-pen circle around a number whose source is open. `desk` shows it only on the wide layout. */
export function RedRing({ on, desk, children }: { on: boolean; desk: boolean; children: ReactNode }) {
  const state = on ? " is-on" : desk ? " is-desk" : "";
  return (
    <span className={`ringed${state}`}>
      {children}
      <svg className="ring" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
        <path d="M15 31C5 25 6 11 26 6.5 46 2 80 3 92 12c8 7 2 19-18 23-20 4-52 3-65-6C4 25 6 16 19 10.5" />
      </svg>
    </span>
  );
}
