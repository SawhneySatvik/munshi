// Rendering a page as the server builds it: the page function runs (its reads go to the API), and the tree it returns
// is mounted in jsdom, so client components run their effects and their calls go to the API as a browser's would.
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

type PageFn = (props: { params: Promise<Record<string, string>>; searchParams: Promise<Record<string, string>> }) => Promise<ReactElement>;

export async function render(page: unknown, params: Record<string, string> = { lang: "en" }, search: Record<string, string> = {}): Promise<HTMLElement> {
  const tree = await (page as PageFn)({ params: Promise.resolve(params), searchParams: Promise.resolve(search) });
  await act(async () => {
    root?.unmount();
    document.body.replaceChildren();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    root.render(tree);
  });
  return document.body.firstElementChild as HTMLElement;
}

export async function click(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error("test: nothing to click");
  await act(async () => {
    (el as HTMLElement).click();
  });
}

/** Types into a React-controlled field as a person would. */
export async function type(el: Element | null | undefined, value: string): Promise<void> {
  if (!el) throw new Error("test: no field to type into");
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export async function submit(form: Element | null | undefined): Promise<void> {
  if (!form) throw new Error("test: no form");
  await act(async () => {
    (form as HTMLFormElement).requestSubmit();
  });
}

export const until = (check: () => void, timeout = 20_000) => vi.waitFor(check, { timeout, interval: 50 });

/** Each invalid field's error, as a screen reader reaches it: the field's aria-describedby names the element that says it. */
export function fieldErrors(root: ParentNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of root.querySelectorAll<HTMLInputElement>('[aria-invalid="true"]')) {
    const ids = field.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
    out[field.name] = ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
  }
  return out;
}

export const button = (root: ParentNode, text: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text || b.getAttribute("aria-label") === text) as HTMLButtonElement | undefined;

/** The page's text outside every element that may carry digits from the API or the clock: figures (with their ref),
 * shop hours, dates and times, codes and references, ordinal labels. What is left must hold no digit. */
export function looseDigits(root: HTMLElement): string[] {
  const copy = root.cloneNode(true) as HTMLElement;
  for (const el of copy.querySelectorAll(".fig, .hours, .days, .slot, time, code, .contents-n, .source-panel, .eyebrow, [data-source='request'], select, .offer-code, .paper-code, .fine")) el.remove();
  return (copy.textContent ?? "").match(/[^\s]*\d[^\s]*/g) ?? [];
}
