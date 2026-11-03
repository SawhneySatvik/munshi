import { notFound, redirect } from "next/navigation";
import { RequestsView } from "../../../components/app/PeopleViews";
import { loadRequests } from "../../../lib/server/people";
import { currentSession } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Requests" };

// Absent (404) while the shop can use neither bookings nor its site.
export default async function RequestsRoute() {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const data = await loadRequests(session);
  if (!data) notFound();
  return <RequestsView data={data} />;
}
