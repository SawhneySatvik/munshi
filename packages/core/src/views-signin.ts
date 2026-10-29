// The demo sign-in's picker (apps/web/app/sign-in/page.tsx shows it): the demo shop's active members, owners first.
// Read under the shop's tenant with no actor: no one is signed in yet.
import type pg from 'pg';
import { withTx } from './session.ts';
import { read } from './views-common.ts';

export function viewSignIn(pool: pg.Pool, tenantId: string): Promise<{ id: string; name: string; role: string }[]> {
  return withTx(pool, { kind: 'system', tenantId }, (c) =>
    read(
      c,
      `select id::text, display_name as name, role from ops.member where active
        order by array_position(array['owner', 'manager', 'staff'], role), display_name`,
    ),
  );
}
