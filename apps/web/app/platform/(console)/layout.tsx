import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { ConsoleFrame } from "../../../components/platform/Console";
import { operatorOr404 } from "../../../lib/server/platform-session";
import { signOutOfConsole } from "../actions";

export const metadata: Metadata = { title: "Munshi · Platform console", robots: { index: false, follow: false } };

// The console's frame, drawn only for a live operator session: without one the layout itself is 404, so no
// part of the console renders around a page's own 404. Each page checks again, for the operator it acts as.
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  await operatorOr404(await cookies());
  return (
    <ConsoleFrame signedIn signOut={signOutOfConsole}>
      {children}
    </ConsoleFrame>
  );
}
