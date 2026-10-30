// Guarantee clause 2 on a public page: every number shown is a figure the API returned, rendered with the ref of the
// published cell it came from (`data-ref`, or `data-from` for a figure the API worked out from cells) and a "source"
// button that asks the API for that cell's book row. A figure whose ref does not parse renders "Cannot verify", never
// its digits. Usable from server and client components alike (no state here; the button is the client part).
import { CANNOT_VERIFY, type DerivedMoney, formatMoney, type IntFigure, isRef, type MoneyFigure } from "@munshi/sdk";
import type { Lang } from "../lib/business.ts";
import { fill, ui } from "../lib/i18n.ts";
import { Source } from "./Source.tsx";

function Unverified({ lang }: { lang: Lang }) {
  return (
    <span className="fig fig-unverified" data-unverified="">
      {ui.cannotVerify[lang]}
    </span>
  );
}

/** A money cell (its ref) or the API's derived sum (the refs it came from). */
export function Money({ fig, lang, what }: { fig: MoneyFigure | DerivedMoney; lang: Lang; what: string }) {
  const text = formatMoney(fig);
  if (text === CANNOT_VERIFY) return <Unverified lang={lang} />;
  const refs = "ref" in fig ? [fig.ref] : fig.from;
  return (
    <span className="fig-wrap">
      <span className="fig" {...("ref" in fig ? { "data-ref": fig.ref } : { "data-from": fig.from.join(" ") })}>
        {text}
      </span>
      <Source refs={refs} derived={!("ref" in fig)} lang={lang} what={what} />
    </span>
  );
}

/**
 * A whole-number cell (minutes, sessions, days, basis points) in a phrase: `phrase` takes {n}. `scale` divides for
 * display only (basis points shown as per cent); the digits are still the cell's.
 */
export function Count({ fig, lang, phrase, what, scale = 1 }: { fig: IntFigure; lang: Lang; phrase: string; what: string; scale?: number }) {
  if (!isRef(fig.ref) || !Number.isSafeInteger(fig.value)) return <Unverified lang={lang} />;
  const n = scale === 1 ? fig.value : fig.value / scale;
  return (
    <span className="fig-wrap">
      <span className="fig" data-ref={fig.ref}>
        {fill(phrase, { n: n.toLocaleString(lang === "hi" ? "hi-IN" : "en-IN") })}
      </span>
      <Source refs={[fig.ref]} derived={false} lang={lang} what={what} />
    </span>
  );
}

/** A duration cell in minutes as "1 h 30 min". */
export function Minutes({ fig, lang, what }: { fig: IntFigure; lang: Lang; what: string }) {
  if (!isRef(fig.ref) || !Number.isSafeInteger(fig.value)) return <Unverified lang={lang} />;
  const h = Math.floor(fig.value / 60);
  const m = fig.value % 60;
  const text = lang === "hi" ? [h ? `${h} घंटा` : "", m || !h ? `${m} मिनट` : ""] : [h ? `${h} h` : "", m || !h ? `${m} min` : ""];
  return (
    <span className="fig-wrap">
      <span className="fig" data-ref={fig.ref}>
        {text.filter(Boolean).join(" ")}
      </span>
      <Source refs={[fig.ref]} derived={false} lang={lang} what={what} />
    </span>
  );
}
