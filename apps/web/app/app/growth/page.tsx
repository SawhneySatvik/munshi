import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Growth } from "../../../components/Growth";
import { loadGrowth } from "../../../lib/server/growth";
import { sessionFrom } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Growth" };

// Growth readings (Paytm edition), read-only, for an owner or a manager: anyone else gets 404.
export default async function GrowthRoute() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  const data = await loadGrowth(session);
  if (!data) notFound();
  return <Growth data={data} />;
}
