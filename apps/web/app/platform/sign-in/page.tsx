import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Button } from "../../../components/Button";
import { ConsoleFrame, ConsoleHead, Control, Notice } from "../../../components/platform/Console";
import { consoleConfigured, operatorFrom } from "../../../lib/server/platform-session";
import { signInToConsole } from "../actions";

export const metadata: Metadata = { title: "Munshi · Operator sign-in", robots: { index: false, follow: false } };

// An operator's sign-in (BLUEPRINT §6.5): email and password (the identity adapter), and a code from the authenticator
// app, which counts once. Every failure reads the same one line. 404 where the console is not configured.
export default async function OperatorSignInPage(props: { searchParams: Promise<{ failed?: string | string[] }> }) {
  if (!consoleConfigured()) notFound();
  if (await operatorFrom(await cookies())) redirect("/platform");
  const q = await props.searchParams;
  return (
    <ConsoleFrame signedIn={false}>
      <ConsoleHead
        id="op-sign-in-h"
        kicker="Superadmin"
        title="Operator sign-in"
        lede="For Munshi's operators only. A shop's owner or staff signs in at the shop's own sign-in, never here."
      />
      {q.failed === "1" ? <Notice tone="warn">That did not work. Check the email, the password and the code, and try again.</Notice> : null}
      <form action={signInToConsole} className="l-card pc-form" aria-labelledby="op-sign-in-h">
        <Control label="Email">
          <input className="pc-input" name="email" type="email" autoComplete="username" required />
        </Control>
        <Control label="Password">
          <input className="pc-input" name="password" type="password" autoComplete="current-password" required />
        </Control>
        <Control label="Code from your authenticator app" hint="Six digits. Each code counts once.">
          <input className="pc-input" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required />
        </Control>
        <Button type="submit" variant="primary">
          Sign in
        </Button>
      </form>
    </ConsoleFrame>
  );
}
