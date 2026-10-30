// What the BP-APP screen tests share: a page rendered as the server returns it (a server component's element whose
// `data` prop the view gets), every ref in that data checked to land on a stored cell of the page's own snapshots,
// the page's text scanned for a digit without a source (render.tsx's unsourced), and a switched-off screen's 404.
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { expect } from "vitest";
import { LangProvider } from "../components/LangProvider";
import { resolveCell } from "../lib/snapshot";
import type { Lang, Snapshot, SourceRef } from "../lib/types";
import { NotFound } from "./app-state";
import { unsourced } from "./render";

/** Every ref in a page's data. */
export function refsIn(value: unknown, out: SourceRef[] = []): SourceRef[] {
  if (Array.isArray(value)) for (const v of value) refsIn(v, out);
  else if (value && typeof value === "object") {
    if ("snapshotId" in value && "col" in value && "label" in value) out.push(value as SourceRef);
    else for (const v of Object.values(value)) refsIn(v, out);
  }
  return out;
}

export const dataOf = <T = { snapshots: Snapshot[] }>(el: ReactElement) => (el.props as { data: T }).data;

/** Each ref in the page's data resolves to a stored cell of its snapshots; returns how many there are. */
export function resolves(el: ReactElement): number {
  const data = dataOf(el);
  const refs = refsIn(data);
  for (const r of refs) expect(resolveCell(data.snapshots, r), `${r.label.en}: ${r.col} of row ${r.row}`).toBeDefined();
  return refs.length;
}

/** Renders the page in both languages; each time every digit on it is sourced. Returns the English text. */
export function sourcedInBoth(el: ReactElement): string {
  let text = "";
  for (const lang of ["hi", "en"] as Lang[]) {
    render(<LangProvider initial={lang}>{el}</LangProvider>);
    expect(unsourced(document.body), lang).toEqual([]);
    text = document.body.textContent ?? "";
    if (lang === "en") return text;
    cleanup();
  }
  return text;
}

/** The page answers 404 (a switched-off capability's screen is absent). */
export async function isAbsent(page: () => Promise<unknown>) {
  await expect(page()).rejects.toBeInstanceOf(NotFound);
}

/** The figures a rendered page shows as <Figure>s (each a button with its source in its accessible name). */
export const figures = () => document.querySelectorAll("button.fig").length;
