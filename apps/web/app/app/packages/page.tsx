import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { PackagesView } from "../../../components/app/PackagesView";
import { loadPackages } from "../../../lib/server/sell";
import { sessionFrom } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Packages" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ?holding=<id> opens that holding's balance to redeem a session. Absent (404) while the shop cannot use packages.
export default async function PackagesRoute({ searchParams }: { searchParams: Promise<{ holding?: string }> }) {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  const { holding } = await searchParams;
  const data = await loadPackages(session, holding && UUID.test(holding) ? holding : null);
  if (!data) notFound();
  return <PackagesView data={data} />;
}
