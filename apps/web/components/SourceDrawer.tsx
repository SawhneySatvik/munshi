"use client";

import { type MouseEvent, useLayoutEffect, useRef } from "react";
import { fill, fillText } from "../lib/i18n";
import { findSnapshot, formatTableCell, sameRef } from "../lib/snapshot";
import { clock, dateAndTime } from "../lib/time";
import type { Snapshot, SourceRef } from "../lib/types";
import { useLang } from "./LangProvider";
import { ShelfThumbnail } from "./ShelfThumbnail";
import { Sticker } from "./Sticker";
import { WhyChain } from "./WhyChain";
import { DRAWER_ID, useSources } from "./Sources";
import "./SourceDrawer.css";

/**
 * Where a number comes from: the stored snapshot it was read from, with its cell highlighted. On the desk it is an open,
 * non-modal panel beside the brief showing the first finding's source by default. On a phone it is hidden until a chip
 * is tapped, then shown modally over a scrim (the native dialog keeps focus in and the page behind inert). Under the
 * table, "Why this number" walks the cell back to the decision behind it and who approved it (WhyChain).
 */
export function SourceDrawer() {
  const { lang, t } = useLang();
  const { snapshots, openRef, deskRef, overlay, close } = useSources();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const modal = useRef(false);

  useLayoutEffect(() => {
    const d = dialog.current;
    if (!d) return;
    const wantModal = openRef !== null && overlay;
    if (wantModal && !modal.current) {
      d.close();
      d.showModal();
      modal.current = true;
    } else if (!wantModal && (modal.current || !d.open)) {
      if (d.open) d.close();
      d.show();
      modal.current = false;
    }
    if (openRef) heading.current?.focus();
    // A wide read can overflow a phone's panel sideways: bring the highlighted cell into view (jsdom lacks the method).
    d.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [openRef, overlay]);

  const shown = openRef ?? deskRef;
  const snapshot = shown && findSnapshot(snapshots, shown.snapshotId);
  if (!shown || !snapshot) return null;

  // Esc closes a modal dialog natively; the close event (fired late) syncs the state unless the dialog is open again.
  const onClose = () => {
    if (!dialog.current?.open && openRef) close();
  };
  // A click on the backdrop lands on the dialog itself; clicks in the panel land on its children.
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget && openRef) close();
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a backdrop click is a pointer shortcut; Esc (native) and the close button are the keyboard path.
    <dialog
      id={DRAWER_ID}
      ref={dialog}
      open
      className={`src ${openRef ? "is-open" : "is-desk"}`}
      aria-labelledby="src-h"
      onClose={onClose}
      onClick={onBackdrop}
    >
      <div className="src-panel">
        <div className="src-head">
          <h2 id="src-h" ref={heading} tabIndex={-1}>
            {t.srcHeading}
          </h2>
          <button type="button" className="src-x" onClick={close}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
            <span className="vh">{t.close}</span>
          </button>
        </div>
        <p className="src-what">
          {snapshot.title[lang]}
          {snapshot.simulatedSupplier && (
            <>
              {" "}
              <Sticker tone="yellow">{t.simulatedSupplier}</Sticker>
            </>
          )}
        </p>
        <p className="src-meta">
          snap · {snapshot.query} · {fill(t.srcRead, { when: <time dateTime={snapshot.readAt}>{dateAndTime(snapshot.readAt, lang)}</time> })}
        </p>
        <LedgerTable snapshot={snapshot} highlight={shown} />
        {snapshot.photo && (
          <ShelfThumbnail
            className="src-shelf"
            photo={snapshot.photo}
            label={fillText(t.shelfPhotoAlt, { when: clock(snapshot.photo.takenAt, lang) })}
          />
        )}
        <p className="src-note">{t.srcNote}</p>
        {/* Why this number (W2-A): the walk from this cell to who approved what it was read from, on request. */}
        <WhyChain key={`${shown.snapshotId}.${shown.row}.${shown.col}`} shown={shown} />
      </div>
    </dialog>
  );
}

/** The snapshot's rows as stored (column names and values untranslated), the referenced cell highlighted. */
function LedgerTable({ snapshot, highlight }: { snapshot: Snapshot; highlight: SourceRef }) {
  return (
    <div className="ledger-scroll">
      <table className="ledger" lang="en">
        <thead>
          <tr>
            <th scope="col">row</th>
            {snapshot.columns.map((c) => (
              <th scope="col" key={c.key} className={c.numeric ? "n" : undefined}>
                {c.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snapshot.rows.map((row, i) => {
            const rowNo = i + 1;
            return (
              <tr key={rowNo}>
                <td className="r">{rowNo}</td>
                {snapshot.columns.map((c) => {
                  const hl = sameRef(highlight, { ...highlight, row: rowNo, col: c.key });
                  const classes = [c.numeric ? "n" : "", hl ? "hl" : ""].filter(Boolean).join(" ");
                  return (
                    <td key={c.key} className={classes || undefined} aria-current={hl ? "true" : undefined} data-cell="">
                      {formatTableCell(row[c.key])}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
