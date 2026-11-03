"use client";

import { fill, fillText } from "../lib/i18n";
import { findSnapshot } from "../lib/snapshot";
import { clock } from "../lib/time";
import type { Finding } from "../lib/types";
import { FindingMoves } from "./FindingMoves";
import { Figure } from "./shell/Figure";
import { useLang } from "./LangProvider";
import { ShelfThumbnail } from "./ShelfThumbnail";
import { Sticker } from "./Sticker";
import { useSources } from "./Sources";
import "./LedgerCard.css";

/** The morning brief: one ruled card, a row per finding (numbered from `first`), every figure in it a Figure (a snapshot ref).
 *  A row the server offers moves for (its finding ids) carries Why?, Draft the fix, Snooze and Dismiss; the offline view
 *  (`moves={false}`) shows the rows alone, every action being a write. */
export function LedgerCard({ findings, first = 1, moves = true }: { findings: Finding[]; first?: number; moves?: boolean }) {
  return (
    <ol className="finds">
      {findings.map((finding, i) => (
        <li key={finding.id}>
          <FindingRow finding={finding} seq={first + i} />
          {moves && finding.ids?.length ? (
            <FindingMoves
              ids={finding.ids}
              card={finding.card}
              why={Boolean(finding.why)}
              fix={Boolean(finding.fix)}
              quiet={Boolean(finding.quiet)}
              offer={finding.offer}
              paypal={finding.paypal}
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function FindingRow({ finding, seq }: { finding: Finding; seq: number }) {
  const { lang, t } = useLang();
  const { snapshots } = useSources();

  const top = (kicker: string, simulated = false) => (
    <div className="find-top">
      <span className="seq">{String(seq).padStart(2, "0")}</span>
      <span className="kicker">{kicker}</span>
      {simulated && <Sticker tone="yellow">{t.simulatedSupplier}</Sticker>}
    </div>
  );
  const name = (text: string) => <span data-name="">{text}</span>;

  switch (finding.kind) {
    case "shelf_gap": {
      const photo = findSnapshot(snapshots, finding.shelf.snapshotId)?.photo;
      return (
        <div className="find">
          {top(t.shelfGap)}
          <p className="find-title">{name(finding.item)}</p>
          {photo && (
            <div className="find-side">
              <ShelfThumbnail photo={photo} label={fillText(t.shelfPhotoAlt, { when: clock(photo.takenAt, lang) })} />
            </div>
          )}
          <p className="find-line">{fill(t.booksSay, { n: <Figure cell={finding.books} /> })}</p>
          <p className="find-line">{fill(t.shelfShows, { n: <Figure cell={finding.shelf} /> })}</p>
        </div>
      );
    }
    case "price_rise":
      return (
        <div className="find">
          {top(t.priceRise, finding.supplier.simulated)}
          <p className="find-title">{fill(t.priceTitle, { item: name(finding.item), source: name(finding.now.label[lang]) })}</p>
          <p className="find-line">
            {fill(t.priceLine, { was: <Figure cell={finding.was} />, now: <Figure cell={finding.now} /> })}
          </p>
        </div>
      );
    case "overdue_credit":
      return (
        <div className="find">
          {top(t.overdueCredit)}
          <p className="find-line">
            {fill(t.overdueLine, {
              count: <Figure cell={finding.customers} />,
              owed: <Figure cell={finding.owed} />,
              days: <Figure cell={finding.days} />,
            })}
          </p>
        </div>
      );
    case "expiry":
      return (
        <div className="find">
          {top(t.expiring)}
          <p className="find-title">{name(finding.item)}</p>
          <p className="find-line">
            {fill(t.expiryLine, { left: <Figure cell={finding.left} />, days: <Figure cell={finding.days} /> })}
          </p>
          {finding.value ? <p className="find-line">{fill(t.expiryRisk, { value: <Figure cell={finding.value} /> })}</p> : null}
        </div>
      );
    case "short_settlement":
      return (
        <div className="find">
          {top(t.shortSettlement)}
          <p className="find-line">
            {fill(t.shortLine, { day: <Figure cell={finding.day} />, short: <Figure cell={finding.short} /> })}
          </p>
        </div>
      );
  }
}
