import { MEMORY } from "./i18n-memory";
import type { Lang } from "./types";

// A decision card's words for Keeper, refused: by core's reason (its CoreError field, NoteRefusal), or because the
// member may not leave a note. Shared by the decide actions (server) and the cards (client).
export const NOTE_ERRORS = ["note_number", "note_script", "note_length", "note_masked", "note_refused"] as const;
export type NoteError = (typeof NOTE_ERRORS)[number];

const BY_FIELD: Record<string, NoteError> = {
  "note.number": "note_number",
  "note.script": "note_script",
  "note.length": "note_length",
  "note.masked_length": "note_masked",
};

/** The card's error for a refusal core gave about the note, or null when the refusal is not about the note. */
export function noteErrorOf(err: { code: string; fields?: string[] | undefined }): NoteError | null {
  const fields = err.fields ?? [];
  if (err.code === "refused" && fields.includes("note")) return "note_refused";
  for (const f of fields) if (BY_FIELD[f]) return BY_FIELD[f] as NoteError;
  return null;
}

const TEXT: Record<NoteError, keyof (typeof MEMORY)["en"]> = {
  note_number: "noteNumber",
  note_script: "noteScript",
  note_length: "noteLength",
  note_masked: "noteMasked",
  note_refused: "noteRefused",
};

/** The card's words for a note the action refused, or null for any other error. */
export const noteError = (error: string, lang: Lang): string | null =>
  (NOTE_ERRORS as readonly string[]).includes(error) ? MEMORY[lang][TEXT[error as NoteError]] : null;
