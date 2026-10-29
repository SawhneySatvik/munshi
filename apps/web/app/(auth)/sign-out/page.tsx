import type { Metadata } from "next";
import { signOut } from "../actions";
import { Panel, Submit, words } from "../panel";

export const metadata: Metadata = { title: "Munshi · Sign out" };

// Sign-out (BLUEPRINT §6.7): a posted form, never a link, revokes this device's session row and clears its cookie.
export default async function SignOutPage() {
  const w = await words();
  return (
    <Panel id="sign-out-h" title={w.signOutTitle} lede={w.signOutLede}>
      <form action={signOut} className="s-form">
        <Submit>{w.signOut}</Submit>
      </form>
    </Panel>
  );
}
