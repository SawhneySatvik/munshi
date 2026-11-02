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
 * On Home: offers to install the app, once the browser has made its offer (Chrome, Edge, Android). iOS makes none, so
 * Safari is told where Add to Home Screen is. Not shown inside the installed app, and never again once dismissed.
 */
export function InstallPrompt() {
  const { lang } = useLang();
  const p = PWA[lang];
  const offer = useOffer();
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    setHidden(standalone || remembered());
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone);
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
    <aside className="wrap pwa-install" aria-labelledby="pwa-install-h">
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
