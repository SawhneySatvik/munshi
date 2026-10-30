import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { StaffView } from "../../../components/app/PeopleViews";
import { loadStaff } from "../../../lib/server/people";
import { sessionFrom } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Staff" };

// Absent (404) while the shop cannot use staff.
export default async function StaffRoute() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  const data = await loadStaff(session);
  if (!data) notFound();
  return <StaffView data={data} />;
}
