import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OwnerHome } from "../components/OwnerHome";
import { loadHome } from "../lib/server/home";
import { sessionFrom } from "../lib/server/session";

// The owner home, read from the books under the signed-in member. No valid session (none, forged, tampered, expired, or a
// member who is gone): ask the person to sign in.
export default async function Page() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  return <OwnerHome data={await loadHome(session)} />;
}
