import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { LoyaltyView } from "../../../components/app/LoyaltyView";
import { loadLoyalty } from "../../../lib/server/sell";
import { sessionFrom } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Loyalty" };

// Absent (404) while the shop cannot use loyalty.
export default async function LoyaltyRoute() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  const data = await loadLoyalty(session);
  if (!data) notFound();
  return <LoyaltyView data={data} />;
}
