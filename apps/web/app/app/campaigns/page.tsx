import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { CampaignsView } from "../../../components/app/OfficeViews";
import { loadCampaigns } from "../../../lib/server/office";
import { sessionFrom } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Campaigns" };

// Absent (404) while the shop cannot use campaigns.
export default async function CampaignsRoute() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  const data = await loadCampaigns(session);
  if (!data) notFound();
  return <CampaignsView data={data} />;
}
