"use client";

import { OPS, type OpsDict } from "../lib/i18n-ops";
import type { OpsError as Code } from "../lib/ops-types";
import { useLang } from "./LangProvider";

const OWN: Record<Exclude<Code, "signed_out" | "other">, keyof OpsDict> = {
  refused: "errRefused",
  invalid: "errInvalid",
  conflict: "errConflict",
  short: "errShort",
  amount: "errAmount",
  qty: "errQty",
  customer: "errCustomer",
  item: "errItem",
  empty: "errEmpty",
  off: "errOff",
  stale: "errStale",
  card_bad: "errCardBad",
  card_erased: "errCardErased",
  card_missing: "errCardMissing",
};

/** A refused entry in the screen's own words: what went wrong and that nothing changed (never the database's text). */
export function OpsError({ code }: { code: Code }) {
  const { lang, t } = useLang();
  const text = code === "signed_out" ? t.errSignedOut : code === "other" ? t.errOther : OPS[lang][OWN[code]];
  return <p className="ops-error">{text}</p>;
}
