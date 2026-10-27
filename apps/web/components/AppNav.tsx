"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { OPS } from "../lib/i18n-ops";
import { HREF, LABEL, PHONE_SLOTS, SECTIONS, type Section } from "../lib/nav";
import type { Member } from "../lib/types";
import { useLang } from "./LangProvider";
import "./AppNav.css";

// One stroke, one weight, drawn for Munshi on a 24px grid (no icon set).
const ICON: Record<Section | "more", string[]> = {
  home: ["M3.5 11 12 4l8.5 7", "M6 9.5V20h12V9.5", "M10 20v-5.5h4V20"],
  counter: ["M6 3.5h12v17l-2.4-1.6-2.4 1.6-2.4-1.6-2.4 1.6L6 20.5Z", "M9 8.5h6", "M9 12.5h6"],
  credit: ["M6 3.5h12.5v17H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z", "M8.5 3.5v17", "M11.5 8.5h4.5", "M11.5 12.5h4.5"],
  stock: ["M3.5 8 12 4l8.5 4v8.5L12 20.5l-8.5-4Z", "M3.5 8 12 12l8.5-4", "M12 12v8.5"],
  bills: ["M6 3.5h8.5l4 4v13H6Z", "M14.5 3.5v4h4", "M9 12h6.5", "M9 15.5h6.5"],
  suppliers: ["M2.5 6.5h11v10h-11Z", "M13.5 10h4l3 3.2v3.3h-7", "M6.5 19.3a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z", "M17 19.3a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z"],
  reports: ["M4 20.5h16", "M7 17v-5", "M12 17V6.5", "M17 17v-8"],
  more: ["M5.5 12h.01", "M12 12h.01", "M18.5 12h.01"],
};

function Icon({ name }: { name: Section | "more" }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 3.6 : 2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

const MORE_ID = "nav-more";

/**
 * The app's sections for the signed-in role: a bar docked at the bottom of a phone (in the space the voice dock had,
 * `--dock`), a rail down the left of a desk. A phone holds five slots: past that, the last sections sit behind "More",
 * a popover (native light dismiss and Esc). Links do not prefetch: each page mints its snapshots when it renders.
 */
export function AppNav({ role }: { role: Member["role"] }) {
  const { lang } = useLang();
  const o = OPS[lang];
  const path = usePathname();
  const more = useRef<HTMLDivElement>(null);
  const sections = SECTIONS[role];
  const folded = sections.length > PHONE_SLOTS ? sections.slice(PHONE_SLOTS - 1) : [];
  const here = (s: Section) => (s === "home" ? path === "/" : path === HREF[s] || path.startsWith(`${HREF[s]}/`));

  const link = (s: Section, onClick: () => void = () => {}) => (
    <Link className="nav-a" href={HREF[s]} prefetch={false} aria-current={here(s) ? "page" : undefined} onClick={onClick}>
      <Icon name={s} />
      <span>{o[LABEL[s]]}</span>
    </Link>
  );

  return (
    <nav className="nav" aria-label={o.navLabel}>
      <div className="nav-cap" aria-hidden="true" />
      <ul className="nav-list">
        {sections.map((s) => (
          <li key={s} className={folded.includes(s) ? "nav-x" : undefined}>
            {link(s)}
          </li>
        ))}
        {folded.length > 0 && (
          <li className="nav-more">
            <button type="button" className={`nav-a${folded.some(here) ? " is-here" : ""}`} popoverTarget={MORE_ID}>
              <Icon name="more" />
              <span>{o.navMore}</span>
            </button>
          </li>
        )}
      </ul>
      {folded.length > 0 && (
        <div id={MORE_ID} ref={more} popover="auto" className="nav-pop">
          <ul>
            {folded.map((s) => (
              <li key={s}>{link(s, () => more.current?.hidePopover?.())}</li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}
