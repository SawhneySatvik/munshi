import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { InboxView } from "../../../components/app/OfficeViews";
import { loadInbox } from "../../../lib/server/office";
import { sessionFrom } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Inbox" };

// Absent (404) while the shop has messaging switched off.
export default async function InboxRoute() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  const data = await loadInbox(session);
  if (!data) notFound();
  return <InboxView data={data} />;
}
