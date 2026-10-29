import { viewSignIn } from "@munshi/core";
import { SignIn } from "../../components/SignIn";
import { config } from "../../lib/server/config";
import { appPool } from "../../lib/server/db";
import type { Member } from "../../lib/types";

// Demo sign-in: the demo shop's active members, read under its tenant with no actor.
export default async function SignInPage() {
  const members = await viewSignIn(await appPool(), config().demoTenantId);
  return <SignIn members={members as Array<Member & { id: string }>} />;
}
