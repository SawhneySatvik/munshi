import type { Metadata } from "next";
import { SignOutForm } from "../../../components/pwa/SignOutForm";
import { signOut } from "../actions";
import { Panel, Submit, words } from "../panel";

export const metadata: Metadata = { title: "Munshi · Sign out" };

// Sign-out: a posted form, never a link, revokes this device's session row and clears its cookie; as it
// posts, this device's offline store and caches go too (components/pwa/SignOutForm.tsx).
export default async function SignOutPage() {
  const w = await words();
  return (
    <Panel id="sign-out-h" title={w.signOutTitle} lede={w.signOutLede}>
      <SignOutForm action={signOut} className="s-form">
        <Submit>{w.signOut}</Submit>
      </SignOutForm>
    </Panel>
  );
}
