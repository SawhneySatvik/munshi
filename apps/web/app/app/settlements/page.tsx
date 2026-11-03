import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Settlements } from "../../../components/Settlements";
import { loadSettlements } from "../../../lib/server/settlements";
import { sessionFrom } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Settlements" };

// Settlement reconciliation, for an owner or a manager: anyone else gets 404.
export default async function SettlementsRoute() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  const data = await loadSettlements(session);
  if (!data) notFound();
  return <Settlements data={data} />;
}
