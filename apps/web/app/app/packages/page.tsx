import { notFound, redirect } from "next/navigation";
import { PackagesView } from "../../../components/app/PackagesView";
import { loadPackages } from "../../../lib/server/sell";
import { currentSession } from "../../../lib/server/session";
import { UUID } from "../../../lib/parse";

export const metadata = { title: "Munshi · Packages" };

// ?holding=<id> opens that holding's balance to redeem a session. Absent (404) while the shop cannot use packages.
export default async function PackagesRoute({ searchParams }: { searchParams: Promise<{ holding?: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const { holding } = await searchParams;
  const data = await loadPackages(session, holding && UUID.test(holding) ? holding : null);
  if (!data) notFound();
  return <PackagesView data={data} />;
}
