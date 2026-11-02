"use client";

import { Fragment, useEffect, useState } from "react";
import { fill, LANG_COOKIE, parseLang } from "../../lib/i18n";
import { OPS } from "../../lib/i18n-ops";
import { PWA } from "../../lib/i18n-pwa";
import { type Kind, type KeptView, readKept } from "../../lib/offline/store";
import type { StockPage } from "../../lib/ops-types";
import { dayAndTime } from "../../lib/time";
import type { OwnerHome } from "../../lib/types";
import { Button } from "../Button";
import { CannotVerify } from "../CannotVerify";
import { useLang } from "../LangProvider";
import { LedgerCard } from "../LedgerCard";
import { PageHead } from "../PageHead";
import { Figure } from "../shell/Figure";
import { SourceDrawer } from "../SourceDrawer";
import { SourcesProvider } from "../Sources";
import { Sticker } from "../Sticker";
import "../Ops.css";
import { goTo } from "./reload";
import "./pwa.css";

type Which = Kind;

/**
 * The offline view (/offline; the service worker sends an /app page here when the network is gone): the Home brief and
 * the stock list this device kept, rendered from their stored cells through the same Figure and source drawer, under
 * "Offline · this page as opened at <time>" (each figure's source still shows its own cell's read time). Read-only: no
 * form, and every action is a disabled button. Online, it is not a way around the session: once the network answers,
 * it goes back to the page it stands in for, and the server decides.
 */
export function OfflineView() {
  const [kept, setKept] = useState<{ views: KeptView[]; stale: Kind[] } | null>(null);
  const [which, setWhich] = useState<Which>("home");
  const [from, setFrom] = useState("/app");
  const { lang, setLang } = useLang();
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on load.
  useEffect(() => {
    // The worker kept this page in the language of the day it was kept: follow the person's choice now.
    const chosen = parseLang(document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`))?.[1]);
    if (chosen !== lang) setLang(chosen);
    const q = new URLSearchParams(window.location.search);
    const back = q.get("from")?.startsWith("/app") ? (q.get("from") as string) : "/app";
    setFrom(back);
    setWhich(q.get("view") === "stock" || back.startsWith("/app/stock") ? "stock" : "home");
    // The network may say online and still fail: go back only once the server answers (/api is never the worker's).
    if (navigator.onLine) {
      void fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(3000) })
        .then((r) => (r.ok ? goTo(back) : setKeptFromStore()))
        .catch(() => setKeptFromStore());
    } else setKeptFromStore();
    function setKeptFromStore() {
      void readKept().then(setKept);
    }
  }, []);
  if (kept === null) return null;
  return <OfflineBody views={kept.views} stale={kept.stale} which={which} back={from} />;
}

export function OfflineBody({ views, stale = [], which, back = "/app" }: { views: KeptView[]; stale?: Kind[]; which: Which; back?: string }) {
  const { lang } = useLang();
  const p = PWA[lang];
  const home = views.find((v): v is KeptView & { kind: "home" } => v.kind === "home");
  const stock = views.find((v): v is KeptView & { kind: "stock" } => v.kind === "stock");
  const shown = which === "stock" ? stock : home;
  const tabs = (
    <nav className="offline-tabs" aria-label={p.offlineTitle}>
      <a href="/offline?view=home" aria-current={which === "home" ? "page" : undefined}>
        {p.offlineHome}
      </a>
      <a href="/offline?view=stock" aria-current={which === "stock" ? "page" : undefined}>
        {p.offlineStock}
      </a>
      <a href={back}>{p.offlineBack}</a>
    </nav>
  );
  if (!shown) {
    return (
      <main className="wrap ops offline">
        <PageHead
          id="offline-h"
          kicker={which === "stock" ? p.offlineStock : p.offlineHome}
          title={p.offlineTitle}
          lede={stale.includes(which) ? p.offlineStale : p.offlineNothing}
        />
        {tabs}
      </main>
    );
  }
  const shop = shown.kind === "home" ? shown.data.shop.name : shown.data.shop;
  return (
    <SourcesProvider snapshots={shown.data.snapshots} deskRef={null}>
      <main className="wrap ops offline">
        <PageHead
          id="offline-h"
          kicker={fill(p.offlineOpenedAt, { when: <time dateTime={shown.openedAt}>{dayAndTime(shown.openedAt, lang)}</time> })}
          title={<span data-name="">{shop}</span>}
          lede={p.offlineLede}
        />
        {tabs}
        <div className="ops-a">{shown.kind === "home" ? <HomeKept data={shown.data} /> : <StockKept data={shown.data} />}</div>
        <div className="ops-b">
          <SourceDrawer />
        </div>
      </main>
    </SourcesProvider>
  );
}

function HomeKept({ data }: { data: OwnerHome }) {
  const { lang, t } = useLang();
  const p = PWA[lang];
  const waiting = data.drafts.filter((d) => d.status === "proposed");
  return (
    <>
      <section className="ops-sec brief" aria-labelledby="offline-brief-h">
        <h2 id="offline-brief-h" className="ops-h">
          {t.briefHeading}
        </h2>
        <LedgerCard findings={data.findings} />
      </section>
      {waiting.length > 0 && (
        <section className="ops-sec" aria-labelledby="offline-drafts-h">
          <h2 id="offline-drafts-h" className="ops-h">
            {t.waitingForYou}
          </h2>
          <ol className="finds">
            {waiting.map((d) => (
              <li key={d.id} className="row">
                <p>
                  {fill(t.reorderLine, {
                    lines: d.lines.map((line, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: a draft's lines are fixed; their order is their identity.
                      <Fragment key={i}>
                        {i > 0 && ", "}
                        {fill(t.reorderItem, { qty: line.qty ? <Figure cell={line.qty} /> : <CannotVerify />, item: <span data-name="">{line.item}</span> })}
                      </Fragment>
                    )),
                    supplier: <span data-name="">{d.supplier.name}</span>,
                    sim: d.supplier.simulated ? <Sticker tone="yellow">{t.simulated}</Sticker> : null,
                  })}
                </p>
                {d.canDecide && (
                  <p className="offline-do">
                    <Button variant="primary" disabled>
                      {t.approve}
                    </Button>
                    <Button disabled>{t.reject}</Button>
                    <span className="offline-why">{p.offlineNeedsNet}</span>
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
      {data.unverified.map((u) => (
        <CannotVerify key={u.what.en}>{fill(t.unverifiedLine, { what: u.what[lang], reason: u.reason[lang] })}</CannotVerify>
      ))}
    </>
  );
}

function StockKept({ data }: { data: StockPage }) {
  const { lang, t } = useLang();
  const o = OPS[lang];
  const p = PWA[lang];
  return (
    <>
      {data.low.length > 0 && (
        <section className="ops-sec low" aria-labelledby="offline-low-h">
          <h2 id="offline-low-h" className="ops-h">
            {o.lowHeading}
          </h2>
          <ol className="finds">
            {data.low.map((row) => (
              <li key={row.id} className="row">
                <p className="row-title">
                  <mark data-name="">{row.name}</mark>
                </p>
                <p>{fill(o.lowLine, { onHand: <Figure cell={row.onHand} />, days: <Figure cell={row.cover} /> })}</p>
                {row.supplier && (
                  <p>
                    {fill(o.lowSuggest, { qty: <Figure cell={row.suggested} />, supplier: <span data-name="">{row.supplier.name}</span> })}{" "}
                    {row.supplier.simulated && <Sticker tone="yellow">{t.simulated}</Sticker>}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="ops-sec every" aria-labelledby="offline-every-h">
        <h2 id="offline-every-h" className="ops-h">
          {o.allHeading}
        </h2>
        <p className="offline-do">
          <Button variant="primary" disabled>
            {p.offlineRecord}
          </Button>
          <span className="offline-why">{p.offlineNeedsNet}</span>
        </p>
        <ol className="finds">
          {data.items.map((row) => (
            <li key={row.id} className="row">
              <p className="row-title">
                {row.low ? <mark data-name="">{row.name}</mark> : <span data-name="">{row.name}</span>}
                {row.low && <Sticker tone="ink">{o.lowMark}</Sticker>}
              </p>
              <p>{fill(o.booksHold, { onHand: <Figure cell={row.onHand} /> })}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
