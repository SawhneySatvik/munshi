"use client";

import { MEMORY } from "../lib/i18n-memory";
import { useLang } from "./LangProvider";
import "./NoteField.css";

/** The longest note Keeper keeps (core's NOTE_MAX, as the schema counts characters). */
const NOTE_MAX = 160;

/**
 * A decision card's optional words for Keeper (W2-A): why a draft is declined, or what to do from now on. Sent with the
 * verdict; core checks them (no numbers) before anything is written and keeps them as a note citing the decision.
 */
export function NoteField({ id }: { id: string }) {
  const { lang } = useLang();
  return (
    <label className="decide-note" htmlFor={`note-${id}`}>
      <span>{MEMORY[lang].noteLabel}</span>
      <textarea id={`note-${id}`} name="note" rows={2} maxLength={NOTE_MAX} />
    </label>
  );
}
