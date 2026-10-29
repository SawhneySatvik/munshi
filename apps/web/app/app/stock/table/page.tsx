import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { StockTable } from "../../../../components/grid/StockTable";
import { sessionFrom } from "../../../../lib/server/session";
import { loadStock } from "../../../../lib/server/stock";

export const metadata = { title: "Munshi · Stock table" };

export default async function StockTableRoute() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  return <StockTable data={await loadStock(session)} />;
}
