import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BillPhoto } from "../../../components/BillPhoto";
import { BillsView } from "../../../components/books/BillsView";
import { recordedMode } from "../../../lib/server/agent-port";
import { loadBills } from "../../../lib/server/bills";
import { billSuppliers, photoDrafts } from "../../../lib/server/hero";
import { page } from "../../../lib/server/ledger";
import { sessionFrom } from "../../../lib/server/session";

export const metadata: Metadata = { title: "Munshi · Bills" };

// The month's bills from suppliers, read from the books under the signed-in member, and reading one from a photo. The
// bills, the picker's suppliers and the waiting photo drafts are read in the page's one transaction.
export default async function BillsPage() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  const [data, suppliers, waiting] = await page(session, async (c) => [
    await loadBills(session, c),
    await billSuppliers(session, c),
    await photoDrafts(session, { waiting: "purchase.record" }, c),
  ] as const);
  return <BillsView data={data} photo={<BillPhoto key="bill-photo" suppliers={suppliers} waiting={waiting} recorded={recordedMode()} />} />;
}
