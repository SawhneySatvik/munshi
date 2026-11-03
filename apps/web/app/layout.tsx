import "../styles/tokens.css";
import "../styles/base.css";
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Literata, Noto_Sans_Devanagari, Noto_Serif_Devanagari } from "next/font/google";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { LangProvider } from "../components/LangProvider";
import { Pwa } from "../components/pwa/Pwa";
import { BASE_COLOURS } from "../lib/brand";
import { LANG_COOKIE, parseLang } from "../lib/i18n";

// The faces, self-hosted by next/font. tokens.css names them directly rather than through next/font's variables: those
// put a metric-adjusted fallback ahead of the Devanagari face, which then draws glyphs it should not. Each loader must be
// assigned to a const; its @font-face rules ship with this layout's CSS. The app (Neem Ledger) is Literata with
// Noto Serif Devanagari; the product site keeps Plex Mono, with Noto Sans Devanagari, for its mono. The Devanagari faces
// are not preloaded: an English page needs neither, and a Hindi page fetches them when its text first uses them.
const _serif = Literata({ subsets: ["latin"], weight: "variable", axes: ["opsz"] });
const _serifDeva = Noto_Serif_Devanagari({ subsets: ["devanagari"], weight: ["400", "600", "700"], preload: false });
const _mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"] });
const _deva = Noto_Sans_Devanagari({ subsets: ["devanagari"], weight: ["400", "700", "800"], preload: false });

export const metadata: Metadata = {
  title: "Munshi",
  description: "Munshi, the back office for a small shop: counter, stock, buying, books and credit.",
  // The installable app (app/manifest.ts is linked by Next); iOS reads these instead of the manifest.
  applicationName: "Munshi",
  appleWebApp: { capable: true, title: "Munshi", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  // Next writes only mobile-web-app-capable for appleWebApp.capable; iOS Safari still reads the apple- name.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export function generateViewport(): Viewport {
  return { themeColor: BASE_COLOURS["--ground"] };
}

// The document, its faces and its language only. The owner app's shell (navigation, the asking side, the top bar) is
// app/app/layout.tsx, under /app; the site, the demo picker and the sign-in pages bring their own.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value);
  return (
    <html lang={lang}>
      <body>
        <LangProvider initial={lang}>
          {children}
          <Pwa />
        </LangProvider>
      </body>
    </html>
  );
}
