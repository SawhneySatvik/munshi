import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AskProvider } from "../../components/AskProvider";
import { AppNav } from "../../components/shell/AppNav";
import { TopBar } from "../../components/shell/TopBar";
import { brandStyle } from "../../lib/brand";
import { navOf } from "../../lib/server/ops";
import { SESSION_COOKIE, sessionFrom } from "../../lib/server/session";

export const metadata: Metadata = { title: "Munshi · Owner home" };

// The owner app's shell, under /app, in Neem Ledger (D-057). The navigation follows the signed-in member's role; signed
// out there is none (each page sends the person to sign in). The session is read only when its cookie is present, so a
// request without one never needs the database. The asking side (the mic, this session's questions) lives here too, so
// it survives moving between pages. The shell carries the shop's brand (lib/brand.ts): null until a core view returns
// the shop's latest look, so every shop shows the system's look for now. The capability sections (BP-APP) are in the
// navigation only while the shop can use their capability, asked in the layout's own transaction.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE) ? await sessionFrom(jar) : null;
  const nav = session ? await navOf(session) : null;
  if (!session || !nav) {
    return (
      <div className="app-shell">
        <TopBar />
        {children}
      </div>
    );
  }
  return (
    <AskProvider who={session.memberId}>
      <div className="app-shell shell" style={brandStyle(null) ?? undefined}>
        <AppNav role={nav.member.role} extra={nav.extra} />
        <div className="shell-main">
          <TopBar />
          {children}
        </div>
      </div>
    </AskProvider>
  );
}
