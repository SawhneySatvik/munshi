import { notFound, redirect } from "next/navigation";
import { InvoiceView } from "../../../../components/app/InvoicesView";
import { loadInvoice } from "../../../../lib/server/sell";
import { currentSession } from "../../../../lib/server/session";
import { UUID } from "../../../../lib/parse";

export const metadata = { title: "Munshi · Invoice" };

export default async function InvoiceRoute({ params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await loadInvoice(session, id);
  if (!data) notFound();
  return <InvoiceView data={data} />;
}
