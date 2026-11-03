import { notFound, redirect } from "next/navigation";
import { CustomersView } from "../../../components/app/CustomersView";
import { loadCustomers } from "../../../lib/server/sell";
import { currentSession } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Customers" };

export default async function CustomersRoute() {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const data = await loadCustomers(session);
  if (!data) notFound();
  return <CustomersView data={data} />;
}
