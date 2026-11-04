"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PWA } from "../../lib/i18n-pwa";
import { forget, reconcile } from "../../lib/offline/store";
import { Button } from "../Button";
import { useLang } from "../LangProvider";
import { InstallPrompt } from "./InstallPrompt";
import { type InstallOffer, setOffer } from "./install";
import { reloadPage } from "./reload";
import "./pwa.css";

// The pages a person reaches signed out (sign-in, the demo picker, the shop picker, sign-up).
const SIGNED_OUT = /^\/(sign-in|demo|choose-shop|sign-up)(\/|$)/;
// Where the install offer floats: the product site and the signed-out pages. Home has its own, inline; a shop's own
// site (/s/…) is for its customers, who are not offered Munshi.
const OFFERS_INSTALL = /^\/($|how-it-works|developers|sign-in|sign-up|demo|choose-shop)/;

/**
 * At the root of every page:
 * - drops the offline store if it was kept under another session than this device's now (lib/offline/store.ts), and on
 *   every signed-out page: an /app page whose session was revoked elsewhere (a reset, a removed member) lands there;
 * - registers the service worker for this build (`version`, the build id); a new build's worker waits, and the person
 *   is offered a reload. Under `next dev` (no version) it registers none and removes any it finds;
 * - catches the browser's install offer, and floats it on the product site and the signed-out pages (Home has its own);
 * - shows a banner while the device is offline (and briefly when it is back).
 */
export function PwaClient({ version }: { version: string | null }) {
  const { lang } = useLang();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const skipped = useRef(false);
  const path = usePathname();

  useEffect(() => {
    // The offline view prunes as it reads (and says which view was too old); every other page prunes here.
    if (path === "/offline") return;
    void (SIGNED_OUT.test(path ?? "") ? forget() : reconcile());
  }, [path]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;
    // No version (next dev): a worker left by `next start` on this origin would serve stale chunks; it goes.
    if (!version) {
      void sw
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => undefined);
      return;
    }
    // Only an update waits: the first worker on a device takes over at once (there is no page of an older build).
    const offer = (w: ServiceWorker | null) => {
      if (w && sw.controller) setWaiting(w);
    };
    // A new worker taking over reloads the page only when this page asked for it (the first install never does).
    const reload = () => {
      if (!skipped.current) return;
      skipped.current = false;
      reloadPage();
    };
    sw.register(`/sw.js?v=${encodeURIComponent(version)}`, { scope: "/" })
      .then((reg) => {
        offer(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const w = reg.installing;
          w?.addEventListener("statechange", () => {
            if (w.state === "installed") offer(w);
          });
        });
      })
      .catch(() => undefined);
    sw.addEventListener("controllerchange", reload);
    return () => sw.removeEventListener("controllerchange", reload);
  }, [version]);

  useEffect(() => {
    const take = (e: Event) => {
      e.preventDefault();
      setOffer(e as InstallOffer);
    };
    const gone = () => setOffer(null);
    window.addEventListener("beforeinstallprompt", take);
    window.addEventListener("appinstalled", gone);
    return () => {
      window.removeEventListener("beforeinstallprompt", take);
      window.removeEventListener("appinstalled", gone);
    };
  }, []);

  return (
    <>
      {OFFERS_INSTALL.test(path ?? "") && <InstallPrompt floating />}
      <OfflineBanner />
      {waiting && (
        <div role="status" className="pwa-update">
          <span>{PWA[lang].updateReady}</span>
          <Button
            variant="primary"
            onClick={() => {
              skipped.current = true;
              waiting.postMessage("skip");
            }}
          >
            {PWA[lang].updateReload}
          </Button>
        </div>
      )}
    </>
  );
}

export function OfflineBanner() {
  const { lang } = useLang();
  const [state, setState] = useState<"online" | "offline" | "back">("online");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = () => {
      clearTimeout(timer);
      setState("offline");
    };
    const on = () => {
      setState("back");
      timer = setTimeout(() => setState("online"), 4000);
    };
    if (!navigator.onLine) off();
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, []);
  return (
    <div role="status" className={`pwa-banner${state === "online" ? " is-hidden" : ""}${state === "offline" ? " is-offline" : ""}`}>
      {state === "offline" ? PWA[lang].bannerOffline : state === "back" ? PWA[lang].bannerOnline : null}
    </div>
  );
}
