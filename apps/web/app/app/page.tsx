import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { EditionSurfaces } from "../../components/EditionSurfaces";
import { OwnerHome } from "../../components/OwnerHome";
import { readEdition } from "../../lib/edition";
import { loadHome } from "../../lib/server/home";
import { sessionFrom } from "../../lib/server/session";

// The owner home, read from the books under the signed-in member. No valid session (none, forged, tampered, expired, or a
// member who is gone): ask the person to sign in. Under the second edition (MUNSHI_EDITION=paytm) its own screens show as
// placeholders.
export default async function Page() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  return <OwnerHome data={await loadHome(session)} edition={readEdition() === "paytm" ? <EditionSurfaces key="edition" /> : null} />;
}
