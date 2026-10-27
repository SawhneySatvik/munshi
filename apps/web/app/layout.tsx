import "../styles/tokens.css";
import "../styles/editions/paytm.css";
import "../styles/base.css";
import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Bricolage_Grotesque, IBM_Plex_Mono, Noto_Sans_Devanagari } from "next/font/google";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { LangProvider } from "../components/LangProvider";
import { TopBar } from "../components/TopBar";
import { readEdition, THEME_COLOR } from "../lib/edition";
import { LANG_COOKIE, parseLang } from "../lib/i18n";

// The reference's four faces, self-hosted by next/font. tokens.css names them directly rather than through next/font's
// variables: those put a metric-adjusted Arial ahead of Noto, which then draws glyphs (→, ↳) the reference takes from
// Noto or the system. Each loader must be assigned to a const; its @font-face rules ship with this layout's CSS.
const _display = Bricolage_Grotesque({ subsets: ["latin"] });
const _body = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"] });
const _mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"] });
const _deva = Noto_Sans_Devanagari({ subsets: ["devanagari"], weight: ["400", "700", "800"] });

export const metadata: Metadata = {
  title: "Munshi · Owner home",
  description: "Munshi, the back office for a small shop. Demo on synthetic data.",
};

export function generateViewport(): Viewport {
  return { themeColor: THEME_COLOR[readEdition()] };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value);
  const edition = readEdition();
  return (
    <html lang={lang} data-edition={edition}>
      <body>
        <LangProvider initial={lang}>
          <TopBar />
          {children}
        </LangProvider>
      </body>
    </html>
  );
}
