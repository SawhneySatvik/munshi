import { fireEvent, render, screen } from "@testing-library/react";
import { AskProvider } from "../components/AskProvider";
import { LangProvider } from "../components/LangProvider";
import { OwnerHome } from "../components/OwnerHome";
import { TopBar } from "../components/shell/TopBar";
import type { Lang, OwnerHome as OwnerHomeData } from "../lib/types";

/**
 * The shell as the root layout composes it: the top bar, then the owner home, under the language and ask providers. The brief's
 * "+N more" row is opened (unless `collapsed`) so every finding is on the page.
 */
export function renderHome(data: OwnerHomeData, lang: Lang = "en", collapsed = false) {
  const view = render(
    <LangProvider initial={lang}>
      <AskProvider who="test">
        <TopBar />
        <OwnerHome data={data} />
      </AskProvider>
    </LangProvider>,
  );
  const more = screen.queryByRole("button", { name: /more findings|और निष्कर्ष/ });
  if (more && !collapsed) fireEvent.click(more);
  return view;
}

/** jsdom has no matchMedia; the drawer asks it whether to open as an overlay. `phone` answers yes. */
export function fakeMatchMedia(phone: boolean) {
  return (query: string) => ({ matches: phone, media: query, addEventListener() {}, removeEventListener() {} });
}

/** Every object in the home data that names a snapshot cell: each is one source chip on the page. */
export function countRefs(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + countRefs(v), 0);
  if (value && typeof value === "object") {
    if ("snapshotId" in value) return 1;
    return Object.values(value).reduce((n: number, v) => n + countRefs(v), 0);
  }
  return 0;
}

export const DIGIT = /[0-9०-९]/;
// What may carry a digit: a chip (its figure is a resolved cell), a name from the books ("Glucose biscuits 70 g"), a
// timestamp, a stored cell or row number in the source drawer, the brief's row counter ("01"), the person's own words
// (a question typed or spoken, shown as theirs: [data-said]) and a bill's text as the model read it (shown with the
// visible note "not checked against your books": [data-printed], exempt only inside a card that holds the note,
// [data-printed-note]). Model prose never carries the first marker: an answer's text parts render as bare text.
const SOURCED = ".pair, [data-name], time, td[data-cell], td.r, .seq, [data-said]";

/** Text on the page that holds a digit with no source: each text left after removing the sourced elements. */
export function unsourced(root: HTMLElement): string[] {
  const copy = root.cloneNode(true) as HTMLElement;
  for (const el of copy.querySelectorAll(SOURCED)) el.remove();
  for (const el of copy.querySelectorAll("[data-printed]")) if (el.closest(".bk-card")?.querySelector("[data-printed-note]")) el.remove();
  const found: string[] = [];
  const walk = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = n.textContent ?? "";
    if (DIGIT.test(text)) found.push(`${(n.parentElement as HTMLElement).className || n.parentElement?.tagName}: "${text.trim()}"`);
  }
  return found;
}
