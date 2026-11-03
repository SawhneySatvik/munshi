import { consoleShops, consoleSignups, operatorName, withOperator } from "@munshi/core";
import { cookies } from "next/headers";
import { ConsoleHead } from "../../../components/platform/Console";
import { ShopCard } from "../../../components/platform/ShopCard";
import { Signups } from "../../../components/platform/Signups";
import { operatorOr404 } from "../../../lib/server/platform-session";

// Every shop (BLUEPRINT §6.5): who it is, whether its site is verified, its AI and today's calls against its caps, its
// channel grants; each setting beside the approved change that set it. One operator transaction.
export default async function ConsoleShopsPage() {
  const { session, pool } = await operatorOr404(await cookies());
  const { name, shops, signups } = await withOperator(pool, session, async (c) => ({
    name: await operatorName(c, session),
    signups: await consoleSignups(c),
    shops: await consoleShops(c),
  }));
  return (
    <>
      <ConsoleHead
        id="pc-shops-h"
        kicker={`Signed in as ${name}`}
        title="Shops"
        lede="Every shop on this deployment. Open a shop to propose a change to its AI, caps, site or channels."
      />
      <Signups board={signups} />
      <section className="pc-cards" aria-labelledby="pc-shops-h">
        {shops.map((s) => (
          <ShopCard key={s.tenantId} shop={s} />
        ))}
      </section>
    </>
  );
}
