import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ShelfPhoto } from "../../../components/ShelfPhoto";
import { StockBook } from "../../../components/StockBook";
import { recordedMode } from "../../../lib/server/agent-port";
import { photoDrafts } from "../../../lib/server/hero";
import { page } from "../../../lib/server/ops";
import { sessionFrom } from "../../../lib/server/session";
import { loadStock } from "../../../lib/server/stock";

export const metadata = { title: "Munshi · Stock" };

export default async function StockRoute() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  // The books and the waiting shelf-count drafts, in the page's one transaction.
  const [data, waiting] = await page(session, async (c) => [await loadStock(session, c), await photoDrafts(session, { waiting: "stock.count" }, c)] as const);
  return <StockBook data={data} photo={<ShelfPhoto key="shelf-photo" waiting={waiting} recorded={recordedMode()} />} />;
}
