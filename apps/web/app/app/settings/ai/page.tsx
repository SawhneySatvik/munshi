import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionFrom } from "../../../../lib/server/session";
import { AiStaffView } from "./AiStaffView";
import { loadAiStaff } from "./data";

export const metadata = { title: "Munshi · AI staff" };

// Every member sees which model each desk uses; only the owner gets the picker (and only the owner's choice is kept).
export default async function AiStaffRoute() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  return <AiStaffView data={await loadAiStaff(session)} />;
}
