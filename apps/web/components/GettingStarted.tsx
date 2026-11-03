"use client";

import type { Checklist } from "@munshi/core";
import Link from "next/link";
import { ONBOARDING_WORDS } from "../lib/i18n-onboard";
import { useLang } from "./LangProvider";
import "./GettingStarted.css";

// Home's "Getting started": a real shop's first steps, each ticked by the books (core's
// gettingStartedIn reads flags only, no figure, in Home's one page transaction). Shown to a real shop's owner and manager
// until every step is done; nothing for a sample shop or for counter staff (`done` is null). The channels step is the
// owner's only (`channels` null for a manager). The storefront is a link only, for now.
export function GettingStarted({ done }: { done: Checklist | null }) {
  const { lang } = useLang();
  if (!done || (done.items && done.stock && done.staff && done.channels !== false)) return null;
  const w = ONBOARDING_WORDS[lang];
  const steps = [
    { key: "items", label: w.stepItems, href: "/app/stock", done: done.items },
    { key: "stock", label: w.stepStock, href: "/app/stock", done: done.stock },
    { key: "staff", label: w.stepStaff, href: "/app/staff", done: done.staff },
    // The owner's alone: the operator grants a channel, so the step asks Munshi, and links to the channels' state.
    ...(done.channels === null ? [] : [{ key: "channels", label: w.stepChannels, href: "/app/settings#channels-h", done: done.channels }]),
    { key: "storefront", label: w.stepStorefront, href: "/developers", done: false },
  ];
  return (
    <section className="wrap start" aria-labelledby="start-h">
      <h2 className="start-h" id="start-h">
        {w.startTitle}
      </h2>
      <p className="start-lede">{w.startLede}</p>
      <ol className="start-steps">
        {steps.map((s) => (
          <li key={s.key} className={s.done ? "is-done" : undefined} data-step={s.key}>
            <Link href={s.href}>{s.label}</Link>
            <span className="start-state">{s.done ? w.done : w.todo}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
