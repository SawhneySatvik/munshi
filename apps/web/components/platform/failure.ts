// The one line a refused console action comes back with, by core's error code, and for a refusal by the change's kind:
// only a channel grant and an operator change need a fresh code (NEEDS_CODE), so only they name it.
const LINES: Record<string, string> = {
  invalid: "That proposal does not fit: check each value against its limits.",
  conflict: "What this change would do has moved since it was shown. Read the diff again before you approve.",
  not_proposed: "This change has already been decided.",
  not_found: "No such change or shop.",
  cli: "An operator is added from the command line: pnpm platform:approve with this change's id, which writes the new operator's authenticator URI to a file only you can read.",
};
const REFUSED: Record<string, string> = {
  channel_grant: "Refused: a channel grant needs a real shop the operator accepted, and a fresh code from your authenticator app; a code counts once.",
  operator: "Refused: an operator change needs a fresh code from your authenticator app, and a code counts once.",
  tenant_accept: "Refused: this shop can no longer be accepted. It is accepted already, its sign-up expired, or it is not a real shop.",
};

export const failureLine = (code: string | string[] | undefined, kind?: string | string[]) => {
  if (typeof code !== "string") return undefined;
  if (code === "refused") return (typeof kind === "string" && REFUSED[kind]) || "Refused: the platform's rules do not allow this change.";
  return LINES[code] ?? "That did not work. Try again.";
};
