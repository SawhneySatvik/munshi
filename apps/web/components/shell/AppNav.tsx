"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useRef } from "react";
import { OPS } from "../../lib/i18n-ops";
import { beforeMic, type Extra, HREF, LABEL, PHONE_SLOTS, SECTIONS, type Section } from "../../lib/nav";
import type { Member } from "../../lib/types";
import { useLang } from "../LangProvider";
import { MicButton } from "../MicButton";
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
  orders: ["M5 4.5h14v15H5Z", "M8.5 9h7", "M8.5 12.5h7", "M8.5 16h4"],
  customers: ["M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11Z", "M3.5 19.5c.6-3.4 2.8-5.3 5.5-5.3s4.9 1.9 5.5 5.3", "M15.5 5.2a3 3 0 0 1 0 5.6", "M17.5 14.6c1.6.7 2.6 2.3 3 4.9"],
  offers: ["M4 12.5 11.5 5h7v7L11 19.5Z", "M15.2 8.8h.01"],
  packages: ["M4 8h16v11.5H4Z", "M4 8l2.5-3.5h11L20 8", "M12 8v11.5"],
  loyalty: ["M12 4.5l2.3 4.7 5.2.8-3.8 3.6.9 5.2L12 16.4l-4.6 2.4.9-5.2-3.8-3.6 5.2-.8Z"],
  invoices: ["M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8Z", "M9 8h6", "M9 11.5h6", "M9 15h3.5"],
  calendar: ["M4 6h16v14H4Z", "M4 10h16", "M8.5 3.5v4", "M15.5 3.5v4"],
  requests: ["M4.5 5.5h15v10h-9l-4 3.5v-3.5h-2Z", "M8.5 10.5h7"],
  staff: ["M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z", "M5 20c.8-4 3.6-6 7-6s6.2 2 7 6"],
  salary: ["M3.5 7h17v10h-17Z", "M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z", "M6.5 10v4", "M17.5 10v4"],
  office: ["M4 20.5h16", "M6 20.5V8.5h12v12", "M9 8.5V5h6v3.5", "M9.5 12.5h5", "M9.5 16h5"],
  inbox: ["M4 13.5 6.5 5h11l2.5 8.5V19H4Z", "M4 13.5h4.5l1.2 2.2h4.6l1.2-2.2H20"],
  campaigns: ["M4 10v4h3l6 4V6L7 10Z", "M16.5 9.5a3.5 3.5 0 0 1 0 5", "M19 7a7 7 0 0 1 0 10"],
  settings: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z", "M12 3.5v2.5", "M12 18v2.5", "M3.5 12H6", "M18 12h2.5", "M6 6l1.8 1.8", "M16.2 16.2 18 18", "M6 18l1.8-1.8", "M16.2 7.8 18 6"],
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
 * `--dock`), a neem-green rail down the left of a desk (`--rail`) whose cap carries the name. A phone holds four slots with the raised mic in their middle: past that,
 * the last sections sit behind "More", a popover (native light dismiss and Esc). On a desk the mic heads the rail.
 * Links do not prefetch: each page mints its snapshots when it renders.
 */
export function AppNav({ role, extra = [] }: { role: Member["role"]; extra?: Extra[] }) {
  const { lang } = useLang();
  const o = OPS[lang];
  const path = usePathname();
  const more = useRef<HTMLDivElement>(null);
  const sections: Section[] = [...SECTIONS[role], ...extra];
  const folded = sections.length > PHONE_SLOTS ? sections.slice(PHONE_SLOTS - 1) : [];
  const mic = beforeMic(sections.length - folded.length + (folded.length ? 1 : 0));
  // The longest section path that holds this page is the one you are in (/app/staff/salary is Salary, not Staff).
  const at = sections.filter((s) => (s === "home" ? path === HREF.home : path === HREF[s] || path.startsWith(`${HREF[s]}/`))).sort((a, b) => HREF[b].length - HREF[a].length)[0];
  const here = (s: Section) => s === at;

  const link = (s: Section, onClick: () => void = () => {}) => (
    <Link className="nav-a" href={HREF[s]} prefetch={false} aria-current={here(s) ? "page" : undefined} onClick={onClick}>
      <Icon name={s} />
      <span>{o[LABEL[s]]}</span>
    </Link>
  );

  return (
    <nav className="nav" aria-label={o.navLabel}>
      <div className="nav-cap" aria-hidden="true">
        <span className="bar-mark">M</span>
        <span className="word">Munshi</span>
      </div>
      <ul className="nav-list">
        {sections.map((s, i) => (
          <Fragment key={s}>
            {i === mic && <MicButton />}
            <li className={folded.includes(s) ? "nav-x" : undefined}>{link(s)}</li>
          </Fragment>
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
