"use client";

import type { ReactNode } from "react";
import { wipeDevice } from "../../lib/offline/store";

/** Sign-out's form: as it posts, this device's offline store and every cache go (the platform design §2). */
export function SignOutForm({ action, className, children }: { action: () => Promise<void>; className?: string; children: ReactNode }) {
  return (
    <form action={action} className={className} onSubmit={() => void wipeDevice()}>
      {children}
    </form>
  );
}
