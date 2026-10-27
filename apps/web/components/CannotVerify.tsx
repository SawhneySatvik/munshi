"use client";

import type { ReactNode } from "react";
import { useLang } from "./LangProvider";
import "./CannotVerify.css";

/**
 * Stands where a number would be when it has no source. With `children` it is the full line (what and why); without,
 * the inline tag a card shows in place of a figure whose ref did not resolve.
 */
export function CannotVerify({ children }: { children?: ReactNode }) {
  const { t } = useLang();
  if (children === undefined) return <span className="cv-tag">{t.cannotVerify}</span>;
  return (
    <p className="unverified">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M12 2.8 4.5 5.6v6c0 4.6 3.2 8.2 7.5 9.6 4.3-1.4 7.5-5 7.5-9.6v-6Z" />
        <path d="M9 12.4h6" />
      </svg>
      <span>
        <strong>{t.cannotVerify}</strong> {children}
      </span>
    </p>
  );
}
