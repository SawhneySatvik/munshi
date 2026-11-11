import { notFound, redirect } from "next/navigation";
import { PaypalDesk } from "../../../components/paypal-desk/PaypalDesk";
import { formKey } from "../../../lib/server/form-key";
import { loadPaypalDesk } from "../../../lib/server/paypal-desk";
import { currentSession } from "../../../lib/server/session";

export const metadata = { title: "Munshi · PayPal desk" };

// Collections on a grid, for an owner or a manager (the members who see PayPal): anyone else gets 404.
export default async function PaypalDeskRoute() {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const data = await loadPaypalDesk(session);
  if (!data) notFound();
  return <PaypalDesk data={data} formKey={formKey()} />;
}
