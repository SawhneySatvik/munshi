"use client";

import { fill, fillText } from "../lib/i18n";
import { findSnapshot } from "../lib/snapshot";
import { clock } from "../lib/time";
import type { Finding } from "../lib/types";
import { Cell } from "./Cell";
import { useLang } from "./LangProvider";
import { ShelfThumbnail } from "./ShelfThumbnail";
import { Sticker } from "./Sticker";
import { useSources } from "./Sources";
import "./LedgerCard.css";

/** The morning brief: one ruled card, a row per finding (numbered from `first`), every figure in it a Cell (a snapshot ref). */
export function LedgerCard({ findings, first = 1 }: { findings: Finding[]; first?: number }) {
  return (
    <ol className="finds">
      {findings.map((finding, i) => (
        <li key={finding.id}>
          <FindingRow finding={finding} seq={first + i} />
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
          <p className="find-line">{fill(t.booksSay, { n: <Cell sourceRef={finding.books} /> })}</p>
          <p className="find-line">{fill(t.shelfShows, { n: <Cell sourceRef={finding.shelf} /> })}</p>
        </div>
      );
    }
    case "price_rise":
      return (
        <div className="find">
          {top(t.priceRise, finding.supplier.simulated)}
          <p className="find-title">{fill(t.priceTitle, { item: name(finding.item), source: name(finding.now.label[lang]) })}</p>
          <p className="find-line">
            {fill(t.priceLine, { was: <Cell sourceRef={finding.was} />, now: <Cell sourceRef={finding.now} /> })}
          </p>
        </div>
      );
    case "overdue_credit":
      return (
        <div className="find">
          {top(t.overdueCredit)}
          <p className="find-line">
            {fill(t.overdueLine, {
              count: <Cell sourceRef={finding.customers} />,
              owed: <Cell sourceRef={finding.owed} />,
              days: <Cell sourceRef={finding.days} />,
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
            {fill(t.expiryLine, { left: <Cell sourceRef={finding.left} />, days: <Cell sourceRef={finding.days} /> })}
          </p>
          <p className="find-line">{fill(t.expiryRisk, { value: <Cell sourceRef={finding.value} /> })}</p>
        </div>
      );
    case "short_settlement":
      return (
        <div className="find">
          {top(t.shortSettlement)}
          <p className="find-line">
            {fill(t.shortLine, { day: <Cell sourceRef={finding.day} />, short: <Cell sourceRef={finding.short} /> })}
          </p>
        </div>
      );
  }
}
