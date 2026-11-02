// A campaign's copy as the owner edits it: each figure's ref token (⟨snap:…⟩, a stored cell) shows as a mark, ⟦a⟧ for
// the first figure, ⟦b⟧ for the next, so the field shows no snapshot id. On save each mark goes back to its token; a mark
// that names no figure is refused here, and anything else (a typed digit, a token pasted in) is held by core to K3.
// The person can keep, move or delete a figure's mark.
const TOKEN = /⟨snap:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}·\d{1,6}·[a-z_][a-z0-9_]{0,62}⟩/g;
const MARK = /⟦([a-z])⟧/g;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

/** The words with marks for figures, and the tokens in mark order (the same cell twice is one mark). */
export function toMarks(body: string): { text: string; figures: string[] } {
  const figures: string[] = [];
  const text = body.replace(TOKEN, (token) => {
    let at = figures.indexOf(token);
    if (at < 0) at = figures.push(token) - 1;
    return at < ALPHABET.length ? `⟦${ALPHABET[at]}⟧` : token;
  });
  return { text, figures };
}

/** The words with each mark back as its token; null when a mark names no figure, or a figure is not a token. */
export function fromMarks(text: string, figures: unknown): string | null {
  if (!Array.isArray(figures) || figures.length > ALPHABET.length || !figures.every((f) => typeof f === "string" && new RegExp(`^${TOKEN.source}$`).test(f))) return null;
  let bad = false;
  const body = text.replace(MARK, (_, letter: string) => {
    const token = figures[ALPHABET.indexOf(letter)] as string | undefined;
    if (!token) bad = true;
    return token ?? "";
  });
  return bad ? null : body;
}

export const markOf = (at: number) => `⟦${ALPHABET[at] ?? "?"}⟧`;
