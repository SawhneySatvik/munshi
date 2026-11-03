"use client";

import { PAYPAL } from "../lib/i18n-paypal";
import { useLang } from "./LangProvider";
import { Sticker } from "./Sticker";

/**
 * The PayPal label on every PayPal surface. With the sandbox keys set it is the "PayPal sandbox" sticker; without them
 * (recorded mode) the sticker stays short and a plain line beside it says nothing is sent to PayPal, so the label wraps
 * inside its card and recorded mode is still said on screen.
 */
export function PayPalSticker({ mode }: { mode: "sandbox" | "recorded" }) {
  const p = PAYPAL[useLang().lang];
  if (mode === "sandbox") return <Sticker tone="ink">{p.label}</Sticker>;
  return (
    <>
      <Sticker tone="ink">{p.recordedLabel}</Sticker> <span className="sticker-note" data-paypal-recorded="">{p.recordedNote}</span>
    </>
  );
}
