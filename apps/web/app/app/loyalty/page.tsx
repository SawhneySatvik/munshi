import { notFound, redirect } from "next/navigation";
import { LoyaltyView } from "../../../components/app/LoyaltyView";
import { loadLoyalty } from "../../../lib/server/sell";
import { currentSession } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Loyalty" };

// Absent (404) while the shop cannot use loyalty.
export default async function LoyaltyRoute() {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const data = await loadLoyalty(session);
  if (!data) notFound();
  return <LoyaltyView data={data} />;
}
