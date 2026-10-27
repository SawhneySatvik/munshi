import { withTx } from "@munshi/core";
import { SignIn } from "../../components/SignIn";
import { config } from "../../lib/server/config";
import { appPool } from "../../lib/server/db";
import type { Member } from "../../lib/types";

// Demo sign-in: the demo shop's active members, read under its tenant with no actor.
export default async function SignInPage() {
  const { rows } = await withTx(await appPool(), { kind: "system", tenantId: config().demoTenantId }, (c) =>
    c.query<Member & { id: string }>(
      `select id::text, name, role from ops.member where active
        order by array_position(array['owner', 'manager', 'staff'], role), name`,
    ),
  );
  return <SignIn members={rows} />;
}
