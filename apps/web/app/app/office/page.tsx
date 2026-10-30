import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { BriefView } from "../../../components/app/OfficeViews";
import { loadBrief } from "../../../lib/server/office";
import { sessionFrom } from "../../../lib/server/session";

export const metadata = { title: "Munshi · The office" };

// The morning brief of each branch (BLUEPRINT §7.6): its order a cell of brief.ranked, each line's figure a cell. The
// owner's and a manager's (counter staff answer 404, as they have no office in the navigation).
export default async function OfficeRoute() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  const data = await loadBrief(session);
  if (data.member.role === "staff") notFound();
  return <BriefView data={data} />;
}
