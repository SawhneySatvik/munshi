import { redirect } from "next/navigation";
import { currentSession } from "../../../../lib/server/session";
import { AiStaffView } from "../../../../components/app/AiStaffView";
import { loadAiStaff } from "../../../../lib/server/ai-staff";

export const metadata = { title: "Munshi · AI staff" };

// Every member sees which model each desk uses; only the owner gets the picker (and only the owner's choice is kept).
export default async function AiStaffRoute() {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  return <AiStaffView data={await loadAiStaff(session)} />;
}
