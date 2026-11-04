"use client";

import { useEffect, useState } from "react";
import { PWA } from "../../lib/i18n-pwa";
import { Button } from "../Button";
import { useLang } from "../LangProvider";
import { useOffer } from "./install";
import "./pwa.css";

const DISMISSED = "munshi.install.dismissed";

const remembered = () => {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
};

/**
 * Offers to install the app, once the browser has made its offer (Chrome, Edge, Android). iOS makes none, so Safari is
 * told where Add to Home Screen is. Inline on Home; `floating` at the foot of the site's pages (PwaClient). Not shown
 * inside the installed app, and never again once dismissed.
 */
export function InstallPrompt({ floating = false }: { floating?: boolean }) {
  const { lang } = useLang();
  const p = PWA[lang];
  const offer = useOffer();
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on load.
  useEffect(() => {
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    const iphone = /iphone|ipad|ipod/i.test(navigator.userAgent);
    // Floating over the site, it is for phones only: a laptop's reader of the landing page is not interrupted.
    const phone = iphone || window.matchMedia?.("(max-width: 40rem)").matches;
    setHidden(standalone || remembered() || (floating && !phone));
    setIos(iphone && !standalone);
  }, []);

  if (hidden || (!offer && !ios)) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      // remembered for this page only
    }
  };
  const install = async () => {
    if (!offer) return;
    await offer.prompt().catch(() => undefined);
    setHidden(true);
  };
  return (
    <aside className={floating ? "pwa-install is-floating" : "wrap pwa-install"} aria-labelledby="pwa-install-h">
      <div className="pwa-install-in">
        <div>
          <h2 id="pwa-install-h">{p.installTitle}</h2>
          <p>{offer ? p.installBody : p.installIos}</p>
        </div>
        <div className="pwa-install-do">
          {offer && (
            <Button variant="primary" onClick={install}>
              {p.installButton}
            </Button>
          )}
          <Button onClick={dismiss}>{p.installDismiss}</Button>
        </div>
      </div>
    </aside>
  );
}
