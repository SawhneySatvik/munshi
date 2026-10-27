// Client-side wording for the hero chain: a notice in the screen's own words, an abstention's reasons, a figure with
// its unit. Never model text: reasons are the agent's fixed codes mapped to fixed phrases.
import { DICT } from "./i18n";
import { HERO, type HeroDict } from "./i18n-hero";
import { OPS, UNIT_WORD } from "./i18n-ops";
import { formatMoney, formatQty } from "./snapshot";
import { calendarDate } from "./time";
import type { CellValue, Lang } from "./types";

const NOTICE: Record<string, keyof HeroDict> = {
  denied: "micDenied",
  none: "micNone",
  short: "micShort",
  failed: "micFailed",
  other: "micFailed",
  empty: "errEmpty",
  too_long: "errTooLong",
  not_audio: "errNotAudio",
  edition: "errEdition",
};

/** A notice from the mic or the ask action ("signed_out" is the app's shared wording). */
export function noticeText(code: string, lang: Lang): string {
  if (code === "signed_out") return DICT[lang].errSignedOut;
  return HERO[lang][NOTICE[code] ?? "micFailed"];
}

/** Why an answer abstained, from the agent's fixed reasons; a reason this screen does not know reads as the general one. */
export function missingText(missing: string[], lang: Lang): string {
  const words = [...new Set(missing.map((m) => HERO[lang][`missing_${m}` as keyof HeroDict] ?? HERO[lang].missing_other))];
  return words.join("; ");
}

/**
 * A cell as an answer shows it: the answer's prose leaves the unit to the figure (the agent refuses a unit beside a
 * handle), so a counted quantity carries its unit here ("24 packs"), money its sign, a date its month.
 */
export function answerValue(cell: CellValue | undefined, lang: Lang): string | null {
  if (!cell) return null;
  switch (cell.t) {
    case "int":
      return new Intl.NumberFormat("en-IN").format(cell.v);
    case "money":
      return formatMoney(cell.minor, cell.currency, "short");
    case "qty": {
      const n = formatQty(cell.milli, cell.unit, lang);
      if (cell.unit !== "pack" && cell.unit !== "piece") return n;
      const word = OPS[lang][UNIT_WORD[cell.unit] ?? "unitPack"];
      return `${n} ${lang === "en" && cell.milli === 1000 ? word.replace(/s$/, "") : word}`;
    }
    case "date":
      return calendarDate(cell.v, lang);
    default:
      return null;
  }
}
