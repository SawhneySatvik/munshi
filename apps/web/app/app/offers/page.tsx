import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { OffersView } from "../../../components/app/OffersView";
import { sessionFrom } from "../../../lib/server/session";
import { loadOffers } from "../../../lib/server/sell";

export const metadata = { title: "Munshi · Offers" };

// Absent (404) while the shop cannot use offers: the view asks can() in the page's one transaction.
export default async function OffersRoute() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  const data = await loadOffers(session);
  if (!data) notFound();
  return <OffersView data={data} />;
}
