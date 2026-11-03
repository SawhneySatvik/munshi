import { redirect } from "next/navigation";
import { StockTable } from "../../../../components/grid/StockTable";
import { currentSession } from "../../../../lib/server/session";
import { loadStock } from "../../../../lib/server/stock";

export const metadata = { title: "Munshi · Stock table" };

export default async function StockTableRoute() {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  return <StockTable data={await loadStock(session)} />;
}
