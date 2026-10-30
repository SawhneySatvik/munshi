import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { CustomerView } from "../../../../components/app/CustomersView";
import { loadCustomer } from "../../../../lib/server/sell";
import { sessionFrom } from "../../../../lib/server/session";

export const metadata = { title: "Munshi · Customer" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function CustomerRoute({ params }: { params: Promise<{ id: string }> }) {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await loadCustomer(session, id);
  if (!data) notFound();
  return <CustomerView data={data} />;
}
