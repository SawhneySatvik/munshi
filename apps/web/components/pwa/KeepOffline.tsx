"use client";

import { type ReactNode, useEffect } from "react";
import { type Kept, keep, keptView } from "../../lib/offline/store";

type Props = Kept & {
  tenant: string;
  member: string;
  /** The session tag the server read with this page's request: the view is kept only while it is this device's tag. */
  tag: string;
  /** When the server rendered the page. */
  openedAt: string;
  children: ReactNode;
};

/**
 * Around Home and the stock list: once the page has rendered, keeps the data it rendered from (its stored snapshots and
 * the refs into them) on this device, for the read-only offline view (lib/offline/store.ts). `data` is the page's own
 * prop, so a test reading the page's element finds it where the page put it.
 */
export function KeepOffline(props: Props) {
  const { kind, data, tenant, member, tag, openedAt } = props;
  useEffect(() => {
    const view = keptView({ kind, data } as Kept, { tenant, member, tag }, openedAt);
    if (view) void keep(view);
  }, [kind, data, tenant, member, tag, openedAt]);
  return props.children;
}
