import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { InvoiceView } from "../../../../components/app/InvoicesView";
import { loadInvoice } from "../../../../lib/server/sell";
import { sessionFrom } from "../../../../lib/server/session";

export const metadata = { title: "Munshi · Invoice" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function InvoiceRoute({ params }: { params: Promise<{ id: string }> }) {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await loadInvoice(session, id);
  if (!data) notFound();
  return <InvoiceView data={data} />;
}
