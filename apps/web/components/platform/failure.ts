// The one line a refused console action comes back with, by core's error code.
const LINES: Record<string, string> = {
  invalid: "That proposal does not fit: check each value against its limits.",
  conflict: "What this change would do has moved since it was shown. Read the diff again before you approve.",
  refused: "Refused: a channel grant or an operator change needs a fresh code from your authenticator app, and a code counts once.",
  not_proposed: "This change has already been decided.",
  not_found: "No such change or shop.",
};

export const failureLine = (code: string | string[] | undefined) => (typeof code === "string" ? (LINES[code] ?? "That did not work. Try again.") : undefined);
