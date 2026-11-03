import type { Session } from "@munshi/core";
import { TAG_COOKIE } from "./tag";

/** What a page tells KeepOffline (server side): whose page it is, the session tag its request carried, and when it rendered. */
export const keepOf = (jar: { get(name: string): { value: string } | undefined }, session: Session) => ({
  tenant: session.tenantId,
  member: session.memberId,
  tag: jar.get(TAG_COOKIE)?.value ?? "",
  openedAt: new Date().toISOString(),
});
