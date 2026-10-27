import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { StockBook } from "../../components/StockBook";
import { sessionFrom } from "../../lib/server/session";
import { loadStock } from "../../lib/server/stock";

export const metadata = { title: "Munshi · Stock" };

export default async function StockRoute() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  return <StockBook data={await loadStock(session)} />;
}
