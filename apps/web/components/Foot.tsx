"use client";

import { fill } from "../lib/i18n";
import type { Member } from "../lib/types";
import { useLang } from "./LangProvider";
// The owner home's footer styles (OwnerHome.css), so every page closes the same way.
import "./OwnerHome.css";

const ROLE = { owner: "roleOwner", manager: "roleManager", staff: "roleStaff" } as const;

/** The demo's plain statement (synthetic data, simulated suppliers, payments recorded, never processed) and who is signed in. */
export function Foot({ shop, member }: { shop: string; member: Member }) {
  const { t } = useLang();
  return (
    <footer className="foot">
      <div className="wrap foot-in">
        <p>{fill(t.footer, { shop: <span data-name="">{shop}</span> })}</p>
        <p className="who">
          {fill(t.signedInAs, { name: <span data-name="">{member.name}</span>, role: t[ROLE[member.role]] })}{" "}
          <a className="switch" href="/sign-in">
            {t.switchPerson}
          </a>
        </p>
      </div>
    </footer>
  );
}
