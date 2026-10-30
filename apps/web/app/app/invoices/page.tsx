import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { InvoicesView } from "../../../components/app/InvoicesView";
import { loadInvoices } from "../../../lib/server/sell";
import { sessionFrom } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Invoices" };

// ?shop=<branch id>&month=YYYY-MM picks the branch and the month (this month at the first branch by default). Absent
// (404) while the shop cannot use GST.
export default async function InvoicesRoute({ searchParams }: { searchParams: Promise<{ shop?: string; month?: string }> }) {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  const { shop, month } = await searchParams;
  const data = await loadInvoices(session, shop ?? null, month ?? null);
  if (!data) notFound();
  return <InvoicesView data={data} />;
}
