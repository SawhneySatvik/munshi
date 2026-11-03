import { notFound, redirect } from "next/navigation";
import { Surplus } from "../../../components/Surplus";
import { loadSurplus } from "../../../lib/server/surplus";
import { currentSession } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Surplus" };

// Surplus for good: the impact tally and the shop's recipients (simulated), for an owner or a manager; anyone else
// gets 404 (core's map).
export default async function SurplusRoute() {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const data = await loadSurplus(session);
  if (!data) notFound();
  return <Surplus data={data} />;
}
