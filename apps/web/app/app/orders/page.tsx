import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { OrdersView } from "../../../components/app/OrdersView";
import { loadOrders } from "../../../lib/server/orders";
import { sessionFrom } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Orders" };

// Absent (404) while the shop cannot use orders.
export default async function OrdersRoute() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  const data = await loadOrders(session);
  if (!data) notFound();
  return <OrdersView data={data} />;
}
