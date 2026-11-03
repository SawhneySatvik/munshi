import { notFound, redirect } from "next/navigation";
import { SettingsView } from "../../../components/app/SettingsView";
import { loadSettings } from "../../../lib/server/office";
import { currentSession } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Settings" };

// The owner's alone: absent (404) for anyone else.
export default async function SettingsRoute() {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const data = await loadSettings(session);
  if (!data) notFound();
  return <SettingsView data={data} />;
}
