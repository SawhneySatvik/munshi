"use client";

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { duration, fill } from "../lib/i18n.ts";
import { formatMoney } from "../lib/money.ts";
import { Check, Chevron, Cross, Plus } from "./Icons.tsx";

export const TRAY_KEY = "munshi-tray";
export const TRAY_MAX = 3;

export type TrayService = { id: string; name: string; minutes: number; minor: number; from: boolean };
export type TrayLabels = {
  add: string;
  remove: string;
  count1: string;
  countN: string;
  request: string;
  full: string;
  show: string;
  hide: string;
  from: string;
  lang: "en" | "hi";
};

type Tray = { ids: string[]; toggle: (id: string) => void; remove: (id: string) => void };
const TrayContext = createContext<Tray>({ ids: [], toggle: () => {}, remove: () => {} });

export function readTray(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(TRAY_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, TRAY_MAX) : [];
  } catch {
    return [];
  }
}

export function writeTray(ids: string[]) {
  try {
    sessionStorage.setItem(TRAY_KEY, JSON.stringify(ids));
  } catch {}
}

export function TrayProvider({ children, known }: { children: ReactNode; known: string[] }) {
  const [ids, setIds] = useState<string[] | null>(null);
  useEffect(() => setIds(readTray().filter((id) => known.includes(id))), [known]);
  // Saved after each change, never before the first read, so a fresh page cannot wipe the stored tray.
  useEffect(() => {
    if (ids) writeTray(ids);
  }, [ids]);
  const toggle = (id: string) =>
    setIds((prev) => {
      const cur = prev ?? [];
      return cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < TRAY_MAX ? [...cur, id] : cur;
    });
  const remove = (id: string) => setIds((prev) => (prev ?? []).filter((x) => x !== id));
  return <TrayContext.Provider value={{ ids: ids ?? [], toggle, remove }}>{children}</TrayContext.Provider>;
}

export function AddButton({ id, name, labels }: { id: string; name: string; labels: Pick<TrayLabels, "add" | "remove"> }) {
  const { ids, toggle } = useContext(TrayContext);
  const on = ids.includes(id);
  const full = !on && ids.length >= TRAY_MAX;
  return (
    <button
      type="button"
      className="add"
      aria-pressed={on}
      disabled={full}
      aria-label={fill(on ? labels.remove : labels.add, { name })}
      onClick={() => toggle(id)}
    >
      {on ? <Check /> : <Plus />}
    </button>
  );
}

export function TrayBar({ services, labels, bookHref }: { services: TrayService[]; labels: TrayLabels; bookHref: string }) {
  const { ids, remove } = useContext(TrayContext);
  const [open, setOpen] = useState(false);
  const chosen = ids.map((id) => services.find((s) => s.id === id)).filter((s) => s !== undefined);
  if (!chosen.length) return null;
  const minutes = chosen.reduce((a, s) => a + s.minutes, 0);
  const total = formatMoney({ minor: chosen.reduce((a, s) => a + s.minor, 0), currency: "INR", ref: null, source: null });
  const anyFrom = chosen.some((s) => s.from);
  return (
    <aside className="tray" aria-label={labels.show}>
      <div className="tray-inner">
        {open ? (
          <ul className="tray-list">
            {chosen.map((s) => (
              <li key={s.id}>
                <span>
                  <strong>{s.name}</strong>
                  <span className="muted">
                    {duration(s.minutes, labels.lang)} · {formatMoney({ minor: s.minor, currency: "INR", ref: null, source: null })}
                  </span>
                </span>
                <button type="button" className="tray-remove" aria-label={fill(labels.remove, { name: s.name })} onClick={() => remove(s.id)}>
                  <Cross />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="tray-row">
          <button type="button" className="tray-summary" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className="tray-count">{fill(chosen.length === 1 ? labels.count1 : labels.countN, { n: chosen.length })}</span>
            <span className="tray-meta">
              {duration(minutes, labels.lang)} · {anyFrom ? fill(labels.from, { price: total }) : total}
            </span>
            <span className="tray-toggle">{open ? labels.hide : labels.show}</span>
          </button>
          <a className="btn btn-primary" href={`${bookHref}?services=${ids.join(",")}`}>
            {labels.request}
            <Chevron />
          </a>
        </div>
        {chosen.length >= TRAY_MAX ? <p className="tray-full">{labels.full}</p> : null}
      </div>
    </aside>
  );
}
