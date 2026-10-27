import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BillsView } from "../../components/books/BillsView";
import { loadBills } from "../../lib/server/bills";
import { sessionFrom } from "../../lib/server/session";

export const metadata: Metadata = { title: "Munshi · Bills" };

// The month's bills from suppliers, read from the books under the signed-in member.
export default async function BillsPage() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  return <BillsView data={await loadBills(session)} />;
}
