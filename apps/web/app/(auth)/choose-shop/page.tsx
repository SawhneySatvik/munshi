import { deploymentKind, memberships } from "@munshi/core";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Button } from "../../../components/Button";
import { DICT, parseLang, LANG_COOKIE } from "../../../lib/i18n";
import { appPool } from "../../../lib/server/db";
import { pickFrom } from "../../../lib/server/session";
import { chooseShop } from "../actions";
import { Panel, words } from "../panel";

export const metadata: Metadata = { title: "Munshi · Choose a shop" };

const ROLE = { owner: "roleOwner", manager: "roleManager", staff: "roleStaff" } as const;

// The tenant picker (BLUEPRINT §6.4): the shops of the identity a sign-in verified a moment ago (its signed cookie), by
// name and role; a session belongs to one of them. Live only.
export default async function ChooseShopPage() {
  const pool = await appPool();
  if ((await deploymentKind(pool)) !== "live") notFound();
  const jar = await cookies();
  const identity = pickFrom(jar);
  if (!identity) redirect("/sign-in");
  const [w, t, shops] = [await words(), DICT[parseLang(jar.get(LANG_COOKIE)?.value)], await memberships(pool, identity)];
  return (
    <Panel id="choose-h" title={w.chooseTitle} lede={w.chooseLede}>
      <form action={chooseShop} className="people">
        {shops.map((s) => (
          <Button key={s.id} type="submit" name="tenant" value={s.id} variant="secondary">
            <span data-name="">{s.name}</span>
            <span className="role">{t[ROLE[s.role]]}</span>
          </Button>
        ))}
      </form>
    </Panel>
  );
}
