import { notFound, redirect } from "next/navigation";
import { CustomerView } from "../../../../components/app/CustomersView";
import { loadCustomer } from "../../../../lib/server/sell";
import { currentSession } from "../../../../lib/server/session";
import { UUID } from "../../../../lib/parse";

export const metadata = { title: "Munshi · Customer" };

export default async function CustomerRoute({ params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await loadCustomer(session, id);
  if (!data) notFound();
  return <CustomerView data={data} />;
}
