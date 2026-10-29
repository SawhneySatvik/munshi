"use client";

import { signIn } from "../app/actions";
import type { Member } from "../lib/types";
import { useLang } from "./LangProvider";

const ROLE = { owner: "roleOwner", manager: "roleManager", staff: "roleStaff" } as const;

/**
 * Pick a person of the demo shop, in the product site's look. Each card posts only that member's id; the server decides
 * whether to sign it. The owner leads.
 */
export function SignIn({ members }: { members: Array<Member & { id: string }> }) {
  const { t } = useLang();
  return (
    <section className="s-screen" aria-labelledby="sign-in-h">
      <h1 className="s-h1" id="sign-in-h">
        {t.signInTitle}
      </h1>
      <p className="s-screen-lede">{members.length ? t.signInLede : t.signInNoShop}</p>
      <form action={signIn} className="s-card-list">
        {members.map((m) => (
          <button key={m.id} type="submit" name="member" value={m.id} className={`s-card${m.role === "owner" ? " is-lead" : ""}`}>
            <span data-name="">{m.name}</span>
            <span className="s-card-k">{t[ROLE[m.role]]}</span>
          </button>
        ))}
      </form>
    </section>
  );
}
