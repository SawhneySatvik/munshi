import { notFound, redirect } from "next/navigation";
import { Growth } from "../../../components/Growth";
import { loadGrowth } from "../../../lib/server/growth";
import { currentSession } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Growth" };

// Growth readings, read-only, for an owner or a manager: anyone else gets 404.
export default async function GrowthRoute() {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const data = await loadGrowth(session);
  if (!data) notFound();
  return <Growth data={data} />;
}
