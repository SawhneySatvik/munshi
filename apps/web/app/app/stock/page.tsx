import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { KeepOffline } from "../../../components/pwa/KeepOffline";
import { ShelfPhoto } from "../../../components/ShelfPhoto";
import { keepOf } from "../../../lib/offline/keep-of";
import { StockBook } from "../../../components/StockBook";
import { recordedMode } from "../../../lib/server/agent-port";
import { photoDrafts } from "../../../lib/server/hero";
import { page } from "../../../lib/server/ops";
import { formKey } from "../../../lib/server/form-key";
import { sessionFrom } from "../../../lib/server/session";
import { loadStock } from "../../../lib/server/stock";

export const metadata = { title: "Munshi · Stock" };

export default async function StockRoute() {
  const jar = await cookies();
  const session = await sessionFrom(jar);
  if (!session) redirect("/sign-in");
  // The books and the waiting shelf-count drafts, in the page's one transaction.
  const [data, waiting] = await page(session, async (c) => [await loadStock(session, c), await photoDrafts(session, { waiting: "stock.count" }, c)] as const);
  return (
    <KeepOffline kind="stock" {...keepOf(jar, session)} data={data}>
      <StockBook data={data} photo={<ShelfPhoto key="shelf-photo" waiting={waiting} recorded={recordedMode()} />} formKey={formKey()} />
    </KeepOffline>
  );
}
