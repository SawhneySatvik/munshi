import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppNav } from "../../components/AppNav";
import { AskProvider } from "../../components/AskProvider";
import { TopBar } from "../../components/TopBar";
import { memberOf } from "../../lib/server/ops";
import { SESSION_COOKIE, sessionFrom } from "../../lib/server/session";

export const metadata: Metadata = { title: "Munshi · Owner home" };

// The owner app's shell, under /app. The navigation follows the signed-in member's role; signed out there is none (each
// page sends the person to sign in). The session is read only when its cookie is present, so a request without one never
// needs the database. The asking side (the mic, this session's questions) lives here too, so it survives moving between
// pages.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE) ? await sessionFrom(jar) : null;
  const member = session ? await memberOf(session) : null;
  if (!session || !member) {
    return (
      <>
        <TopBar />
        {children}
      </>
    );
  }
  return (
    <AskProvider who={session.memberId}>
      <div className="shell">
        <AppNav role={member.role} />
        <div className="shell-main">
          <TopBar />
          {children}
        </div>
      </div>
    </AskProvider>
  );
}
