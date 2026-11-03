import { notFound, redirect } from "next/navigation";
import { Settlements } from "../../../components/Settlements";
import { loadSettlements } from "../../../lib/server/settlements";
import { currentSession } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Settlements" };

// Settlement reconciliation, for an owner or a manager: anyone else gets 404.
export default async function SettlementsRoute() {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const data = await loadSettlements(session);
  if (!data) notFound();
  return <Settlements data={data} />;
}
