"use client";

import { signIn } from "../app/actions";
import type { Member } from "../lib/types";
import { Button } from "./Button";
import { useLang } from "./LangProvider";
import "./SignIn.css";

const ROLE = { owner: "roleOwner", manager: "roleManager", staff: "roleStaff" } as const;

/** Pick a person of the demo shop. Each button posts only that member's id; the server decides whether to sign it. */
export function SignIn({ members }: { members: Array<Member & { id: string }> }) {
  const { t } = useLang();
  return (
    <main className="wrap sign-in">
      <section className="pending" aria-labelledby="sign-in-h">
        <h1 id="sign-in-h">{t.signInTitle}</h1>
        <p className="sign-in-lede">{members.length ? t.signInLede : t.signInNoShop}</p>
        <form action={signIn} className="people">
          {members.map((m) => (
            <Button key={m.id} type="submit" name="member" value={m.id} variant={m.role === "owner" ? "primary" : "secondary"}>
              <span data-name="">{m.name}</span>
              <span className="role">{t[ROLE[m.role]]}</span>
            </Button>
          ))}
        </form>
      </section>
    </main>
  );
}
