import type { Metadata } from "next";
import { OfflineView } from "../../components/pwa/OfflineView";
import { TopBar } from "../../components/shell/TopBar";
import { SITE_FACES } from "../../components/site/fonts";

export const metadata: Metadata = { title: "Munshi · Offline" };

// The offline view's page, outside /app so it needs no session and reads no books: the service worker keeps this page
// and the build files it names, and sends an /app page here when the network is gone. What it shows comes from this
// device's offline store (components/pwa/OfflineView.tsx), read in the browser.
export default function OfflinePage() {
  return (
    <div className={`app-shell ${SITE_FACES}`}>
      <TopBar />
      <OfflineView />
    </div>
  );
}
