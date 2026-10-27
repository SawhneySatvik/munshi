"use client";

import { type FormEvent, startTransition, useActionState, useState } from "react";
import { readBillAction } from "../app/bills/photo-actions";
import { type BillReadLine, type Box, MAX_PHOTO, type Waiting } from "../lib/hero-types";
import { noticeText } from "../lib/hero-words";
import { fill } from "../lib/i18n";
import { BOOKS } from "../lib/i18n-books";
import { HERO, type HeroDict } from "../lib/i18n-hero";
import type { Snapshot, Supplier } from "../lib/types";
import { Figure } from "./books/Figure";
import { ReadLine } from "./books/Sheet";
import { Button } from "./Button";
import { CannotVerify } from "./CannotVerify";
import { Cell } from "./Cell";
import { useLang } from "./LangProvider";
import { PhotoDraftCard } from "./PhotoDraftCard";
import { PhotoPicker, usePhoto } from "./ShelfPhoto";
import { useLentSnapshots } from "./Sources";
import { Sticker } from "./Sticker";
import "./Ops.css";
import "./Photo.css";

const NONE: Snapshot[] = [];

/**
 * Read a supplier's bill from a photo (the /bills slot MS-9b left, data-slot="bill-photo"). The person names the
 * supplier and sends the photo as taken; the result is every line as printed with its figures read on the bill (cells,
 * each with its place on the page, boxed on the photo), which item each matched (exact name or alias, never a model's
 * guess), a price above the last bill flagged with both cells, and the purchase.record draft to approve. In recorded
 * mode it says "Recorded response".
 */
export function BillPhoto({ suppliers, waiting, recorded }: { suppliers: Array<{ id: string } & Supplier>; waiting: Waiting; recorded: boolean }) {
  const { lang, t } = useLang();
  const h = HERO[lang];
  const b = BOOKS[lang];
  const [state, action, pending] = useActionState(readBillAction, null);
  const photo = usePhoto();
  const [supplier, setSupplier] = useState("");
  const [tooBig, setTooBig] = useState(false);
  // The result belongs to the photo it was sent with: a new pick, or a send still pending, shows none of the old one.
  const [sent, setSent] = useState<File | null>(null);
  const live = !pending && sent !== null && sent === photo.file;
  const out = live && state && "result" in state ? state : null;
  useLentSnapshots("bill", out?.snapshots ?? NONE);
  // The drafts waiting when the page was read stay listed: a decision here re-reads the page, and its card must stay
  // to show the outcome.
  const [listed] = useState(waiting);
  useLentSnapshots("bill-waiting", listed.snapshots);
  const result = out?.result;
  const read = result?.kind === "read" ? result : null;
  const shown = new Set([...(read?.draft ? [read.draft.id] : []), ...(result?.kind === "again" ? result.drafts.map((d) => d.id) : [])]);
  const earlier = listed.drafts.filter((d) => !shown.has(d.id));
  const lines = read && out ? out.snapshots.find((s) => s.id === read.lines[0]?.qty.snapshotId) : undefined;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!photo.file) return;
    // Past the server's body limit the action is never reached: say so here instead.
    setTooBig(photo.file.size > MAX_PHOTO);
    if (photo.file.size > MAX_PHOTO) return;
    const form = new FormData();
    form.set("supplier", supplier);
    form.set("photo", photo.file);
    setSent(photo.file);
    startTransition(() => action(form));
  };
  const error = live && state && "error" in state ? state.error : null;

  return (
    <section className="sheet bill-photo" data-slot="bill-photo" aria-labelledby="bill-photo-h">
      <div className="sheet-top">
        <span className="kicker">{b.photoKicker}</span>
        {recorded && (read || result?.kind === "recorded" || result?.kind === "refused") && <Sticker tone="yellow">{h.recordedResponse}</Sticker>}
      </div>
      <h2 id="bill-photo-h">{b.photoTitle}</h2>
      <p className="field-note">{b.photoBody}</p>
      <form className="photo-form" onSubmit={submit}>
        <label className="field">
          <span className="kicker field-label">{h.billSupplier}</span>
          <select name="supplier" className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="" disabled>
              {h.billPickSupplier}
            </option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.simulated ? `${s.name} · ${t.simulatedSupplier}` : s.name}
              </option>
            ))}
          </select>
        </label>
        <PhotoPicker
          label={photo.file ? h.shelfChange : h.shelfPick}
          onPick={(f) => {
            setTooBig(false);
            photo.choose(f);
          }}
        />
        {/* biome-ignore lint/performance/noImgElement: a local object URL of the person's own photo, which next/image cannot optimise. */}
        {photo.url && photo.file?.type.startsWith("image/") && !read && <img className="photo-prev" src={photo.url} alt="" />}
        <Button type="submit" variant="primary" disabled={!photo.file || !supplier || pending}>
          {pending ? h.billReading : h.billRead}
        </Button>
      </form>
      <div role="status" className="photo-status">
        {tooBig && <p className="ops-error">{h.errTooBig}</p>}
        {error && (
          <p className="ops-error">
            {error === "supplier" ? h.errSupplier : error === "empty" ? h.errPhoto : error === "too_long" ? h.errTooBig : noticeText(error, lang)}
          </p>
        )}
        {result?.kind === "refused" && <p className="ops-error">{h[`refused_${result.why}` as keyof HeroDict] ?? h.refused_model_error}</p>}
        {result?.kind === "recorded" && (
          <div className="bill-known">
            <p>{fill(h.billRecorded, { billNo: <span data-name="">{result.billNo}</span> })}</p>
            {result.billId && (
              <a className="press press-open" href={`/bills/${result.billId}`}>
                {h.openBill}
              </a>
            )}
          </div>
        )}
      </div>
      {read && (
        <div className="photo-out">
          <h3 className="photo-h">{fill(h.billLines, { billNo: read.billNo ? <span data-name="">{read.billNo}</span> : <CannotVerify /> })}</h3>
          {read.billDate && (
            <p className="field-line">
              {b.colDate} <Cell sourceRef={read.billDate} />
            </p>
          )}
          {photo.url && <BoxedBill url={photo.url} lines={read.lines} />}
          <div className="bk-card">
            {lines && <ReadLine snapshot={lines} label={h.labelReadOnBill} />}
            <p className="bk-card-note" data-printed-note="">
              {h.billPrintedNote}
            </p>
            <table className="ledger book-table bill-read">
              <thead>
                <tr>
                  <th scope="col">{h.billPrinted}</th>
                  <th scope="col" className="n">
                    {h.billQty}
                  </th>
                  <th scope="col" className="n">
                    {h.billCost}
                  </th>
                </tr>
              </thead>
              <tbody>
                {read.lines.map((line, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a read bill's lines are fixed, in page order.
                  <BillRow key={i} line={line} />
                ))}
              </tbody>
            </table>
          </div>
          {read.why && <p className="field-note">{h[`billWhy_${read.why}` as keyof HeroDict]}</p>}
          {read.draft && <PhotoDraftCard draft={read.draft} />}
          <p className="field-note">{h.photoGone}</p>
        </div>
      )}
      {result?.kind === "again" && (
        <div className="photo-out">
          <p className="field-note">{h.photoAgain}</p>
          {result.drafts.map((d) => (
            <PhotoDraftCard key={d.id} draft={d} />
          ))}
        </div>
      )}
      {earlier.length > 0 && (
        <div className="photo-waiting">
          <h3 className="photo-h">
            {h.waitingHeading} {recorded && <Sticker tone="yellow">{h.recordedResponse}</Sticker>}
          </h3>
          {earlier.map((d) => (
            <PhotoDraftCard key={d.id} draft={d} />
          ))}
        </div>
      )}
    </section>
  );
}

function BillRow({ line }: { line: BillReadLine }) {
  const { lang } = useLang();
  const h = HERO[lang];
  return (
    <tr className={line.item ? undefined : "is-out"}>
      <th scope="row">
        <span className="bill-line">
          <span className="printed" data-printed="">
            {line.printed}
          </span>
          <span className="matched">{line.item ? fill(h.billMatched, { item: <span data-name="">{line.item}</span> }) : h.billNotInCatalogue}</span>
          {line.rise && (
            <span className="bk-rise">
              <Sticker tone="yellow">{fill(h.billRise, { was: <Cell sourceRef={line.rise.was} /> })}</Sticker>
            </span>
          )}
        </span>
      </th>
      <td className="n">
        <Figure sourceRef={line.qty} />
      </td>
      <td className="n">
        <Figure sourceRef={line.cost} />
      </td>
    </tr>
  );
}

const pct = (n: number) => `${n / 10}%`;

/** The bill photo with the place of every figure read on it (the 0–1000 grid of the page). */
function BoxedBill({ url, lines }: { url: string; lines: BillReadLine[] }) {
  const { lang } = useLang();
  const box = (b: Box | null, cls: string, key: string) =>
    b && <span key={key} className={`fig-box ${cls}`} style={{ left: pct(b.x1), top: pct(b.y1), width: pct(b.x2 - b.x1), height: pct(b.y2 - b.y1) }} />;
  return (
    <figure className="boxed">
      <div className="boxed-frame">
        {/* biome-ignore lint/performance/noImgElement: a local object URL of the person's own photo, which next/image cannot optimise. */}
        <img src={url} alt={HERO[lang].billPhotoAlt} />
        {lines.flatMap((l, i) => {
          const cls = l.rise ? "is-gap" : l.item ? "is-ok" : "is-out";
          return [box(l.qtyAt, cls, `q${i}`), box(l.costAt, cls, `c${i}`)];
        })}
      </div>
    </figure>
  );
}
