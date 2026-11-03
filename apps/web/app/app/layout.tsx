import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AiFeaturesProvider } from "../../components/AiFeatures";
import { AskProvider } from "../../components/AskProvider";
import { AppNav } from "../../components/shell/AppNav";
import { SITE_FACES } from "../../components/site/fonts";
import { TopBar } from "../../components/shell/TopBar";
import { brandStyle } from "../../lib/brand";
import { shellOf } from "../../lib/server/ops";
import { currentSession } from "../../lib/server/session";

export const metadata: Metadata = { title: "Munshi · Owner home" };

// The owner app's shell, under /app, in look A: the warm-black shell around paper. It carries the product site's faces
// (Gabarito, Akshar) as a class, which styles/tokens.css reads on the shell. The navigation follows the signed-in member's role; signed
// out there is none (each page sends the person to sign in). The session is checked once per request, shared with the
// page (currentSession); a request without its cookie never needs the database. The asking side (the mic, this
// session's questions) lives here too, so it survives moving between pages. The shell carries the shop's brand (lib/brand.ts): null until a core view returns
// the shop's latest look, so every shop shows the system's look for now. The capability sections are in the
// navigation only while the shop can use their capability, asked in the layout's own transaction with the AI features
// the operator switched off for the shop (every surface below hides or labels them).
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  const shell = session ? await shellOf(session) : null;
  if (!session || !shell) {
    return (
      <div className={`app-shell ${SITE_FACES}`}>
        <TopBar />
        {children}
      </div>
    );
  }
  return (
    <AiFeaturesProvider off={shell.off}>
      <AskProvider who={session.memberId}>
        <div className={`app-shell shell ${SITE_FACES}`} style={brandStyle(null) ?? undefined}>
          <AppNav role={shell.member.role} extra={shell.extra} />
          <div className="shell-main">
            <TopBar />
            {children}
          </div>
        </div>
      </AskProvider>
    </AiFeaturesProvider>
  );
}
