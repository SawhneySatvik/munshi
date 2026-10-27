"use client";

import { type FormEvent, startTransition, useActionState, useEffect, useState } from "react";
import { countShelfAction } from "../app/stock/photo-actions";
import { MAX_PHOTO, type ShelfLine, type Waiting } from "../lib/hero-types";
import { noticeText } from "../lib/hero-words";
import { fill } from "../lib/i18n";
import { HERO, type HeroDict } from "../lib/i18n-hero";
import type { Snapshot } from "../lib/types";
import { Button } from "./Button";
import { Cell } from "./Cell";
import { useLang } from "./LangProvider";
import { PhotoDraftCard } from "./PhotoDraftCard";
import { useLentSnapshots } from "./Sources";
import { Sticker } from "./Sticker";
import "./Ops.css";
import "./Photo.css";

const NONE: Snapshot[] = [];

export function CameraIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8.5a2 2 0 0 1 2-2h2.2l1.6-2.2h5.4l1.6 2.2h2.2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
      <circle cx="12" cy="13" r="3.6" />
    </svg>
  );
}

/** The chosen photo as a local object URL (it never leaves this device except to the action), freed when replaced. */
export function usePhoto() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return { file, url, choose: setFile };
}

/** A hidden file input under a pressable label: a photo taken or chosen (the phone offers both). */
export function PhotoPicker({ label, onPick, accept = "image/png,image/jpeg" }: { label: string; onPick: (f: File | null) => void; accept?: string }) {
  return (
    <label className="press photo-pick">
      <CameraIcon />
      <span>{label}</span>
      <input type="file" name="photo" accept={accept} className="vh" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
    </label>
  );
}

/**
 * Count a shelf from a photo (on /stock). The photo goes to countShelfAction as taken; the result is each product the
 * photo models named and counted, beside what the books hold (both cells), the counting model's own boxes drawn on the
 * photo, and a stock.count draft for every gap, approved or rejected right here. Drafts from earlier photos still
 * waiting are listed too. In recorded mode the result says "Recorded response".
 */
export function ShelfPhoto({ waiting, recorded }: { waiting: Waiting; recorded: boolean }) {
  const { lang } = useLang();
  const h = HERO[lang];
  const [state, action, pending] = useActionState(countShelfAction, null);
  const photo = usePhoto();
  const [tooBig, setTooBig] = useState(false);
  const out = state && "result" in state ? state : null;
  useLentSnapshots("shelf", out?.snapshots ?? NONE);
  // The drafts waiting when the page was read stay listed: a decision here re-reads the page, and its card must stay
  // to show the outcome.
  const [listed] = useState(waiting);
  useLentSnapshots("shelf-waiting", listed.snapshots);
  const result = out?.result;
  const fresh = new Set(result?.kind === "counted" ? result.lines.flatMap((l) => (l.draft ? [l.draft.id] : [])) : []);
  const earlier = listed.drafts.filter((d) => !fresh.has(d.id));

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!photo.file) return;
    // Past the server's body limit the action is never reached: say so here instead.
    setTooBig(photo.file.size > MAX_PHOTO);
    if (photo.file.size > MAX_PHOTO) return;
    const form = new FormData();
    form.set("photo", photo.file);
    startTransition(() => action(form));
  };

  return (
    <section className="sheet shelf-photo" aria-labelledby="shelf-h">
      <div className="sheet-top">
        <h2 id="shelf-h">{h.shelfHeading}</h2>
        {result?.kind === "counted" && recorded && <Sticker tone="yellow">{h.recordedResponse}</Sticker>}
      </div>
      <p className="field-note">{h.shelfLede}</p>
      <form className="photo-form" onSubmit={submit}>
        <PhotoPicker label={photo.file ? h.shelfChange : h.shelfPick} onPick={photo.choose} />
        {/* biome-ignore lint/performance/noImgElement: a local object URL of the person's own photo, which next/image cannot optimise. */}
        {photo.url && photo.file?.type.startsWith("image/") && !(result?.kind === "counted") && <img className="photo-prev" src={photo.url} alt="" />}
        <Button type="submit" variant="primary" disabled={!photo.file || pending}>
          {pending ? h.shelfCounting : h.shelfCount}
        </Button>
      </form>
      <div role="status" className="photo-status">
        {tooBig && <p className="ops-error">{h.errTooBig}</p>}
        {state && "error" in state && <p className="ops-error">{state.error === "empty" ? h.errPhoto : state.error === "too_long" ? h.errTooBig : noticeText(state.error, lang)}</p>}
        {result?.kind === "refused" && <p className="ops-error">{h[`refused_${result.why}` as keyof HeroDict] ?? h.refused_model_error}</p>}
      </div>
      {result?.kind === "counted" && (
        <div className="photo-out">
          <h3 className="photo-h">{h.shelfResult}</h3>
          {photo.url && <Boxed url={photo.url} lines={result.lines} />}
          {result.lines.length > 0 && (
            <ol className="finds">
              {result.lines.map((line) => (
                <li key={line.itemId}>
                  <ShelfRow line={line} />
                </li>
              ))}
            </ol>
          )}
          {result.uncounted.length > 0 && (
            <div className="photo-aside">
              <h4 className="kicker">{h.uncountedHeading}</h4>
              <ul>
                {result.uncounted.map((u) => (
                  <li key={u.item}>
                    <span data-name="">{u.item}</span>: {h[`why_${u.why}` as keyof HeroDict] ?? h.why_model_error}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.unrecognised.length > 0 && (
            <div className="photo-aside">
              <h4 className="kicker">{h.unrecognisedHeading}</h4>
              <p>
                {result.unrecognised.map((p, i) => (
                  <span key={p} className="model-words">
                    {i > 0 && ", "}
                    {p}
                  </span>
                ))}
              </p>
              <p className="field-note">{h.unrecognisedNote}</p>
            </div>
          )}
          {result.lines.flatMap((l) => (l.draft ? [<PhotoDraftCard key={l.draft.id} draft={l.draft} />] : []))}
          <p className="field-note">{h.photoGone}</p>
        </div>
      )}
      {earlier.length > 0 && (
        <div className="photo-waiting">
          <h3 className="photo-h">{h.waitingHeading}</h3>
          {earlier.map((d) => (
            <PhotoDraftCard key={d.id} draft={d} />
          ))}
        </div>
      )}
    </section>
  );
}

function ShelfRow({ line }: { line: ShelfLine }) {
  const { lang, t } = useLang();
  const h = HERO[lang];
  return (
    <div className="row">
      <p className="row-title">
        {line.gap ? <mark data-name="">{line.item}</mark> : <span data-name="">{line.item}</span>}
        {line.gap && <Sticker tone="ink">{t.shelfGap}</Sticker>}
      </p>
      <p>
        {fill(h.booksHold, { n: <Cell sourceRef={line.onHand} /> })} · {fill(h.shelfShows, { n: <Cell sourceRef={line.counted} /> })}
      </p>
      {!line.gap && <p className="field-note">{h.shelfMatches}</p>}
    </div>
  );
}

/** The photo with the counting model's boxes: red for a product whose count differs from the books, ink for one that matches. */
function Boxed({ url, lines }: { url: string; lines: ShelfLine[] }) {
  const { lang } = useLang();
  const h = HERO[lang];
  const size = lines.find((l) => l.size)?.size;
  const pad = size ? Math.max(2, Math.round(size.w / 200)) : 0;
  const gap = lines.find((l) => l.gap);
  return (
    <figure className="boxed">
      <div className="boxed-frame">
        {/* biome-ignore lint/performance/noImgElement: a local object URL of the person's own photo, which next/image cannot optimise. */}
        <img src={url} alt={h.photoAlt} />
        {size && (
          <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none" aria-hidden="true">
            {lines.flatMap((l) =>
              l.boxes.map((b, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the model's boxes, fixed for this result.
                <g key={`${l.itemId}-${i}`} className={l.gap ? "is-gap" : "is-ok"}>
                  {/* a paper halo under the ink, so a box reads on any photo; drawn just outside the unit it marks */}
                  <rect className="halo" x={b.x1 - pad} y={b.y1 - pad} width={b.x2 - b.x1 + 2 * pad} height={b.y2 - b.y1 + 2 * pad} rx="6" />
                  <rect x={b.x1 - pad} y={b.y1 - pad} width={b.x2 - b.x1 + 2 * pad} height={b.y2 - b.y1 + 2 * pad} rx="6" />
                </g>
              )),
            )}
          </svg>
        )}
      </div>
      {gap && <figcaption>{fill(h.shelfBoxed, { item: <span data-name="">{gap.item}</span> })}</figcaption>}
    </figure>
  );
}
