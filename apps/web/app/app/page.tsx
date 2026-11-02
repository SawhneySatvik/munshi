import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { EditionSurfaces } from "../../components/EditionSurfaces";
import { OwnerHome } from "../../components/OwnerHome";
import { InstallPrompt } from "../../components/pwa/InstallPrompt";
import { KeepOffline } from "../../components/pwa/KeepOffline";
import { readEdition } from "../../lib/edition";
import { keepOf } from "../../lib/offline/keep-of";
import { loadHome } from "../../lib/server/home";
import { sessionFrom } from "../../lib/server/session";

// The owner home, read from the books under the signed-in member. No valid session (none, forged, tampered, expired, or a
// member who is gone): ask the person to sign in. Under the second edition (MUNSHI_EDITION=paytm) its own screens show as
// placeholders.
export default async function Page() {
  const jar = await cookies();
  const session = await sessionFrom(jar);
  if (!session) redirect("/sign-in");
  const data = await loadHome(session);
  // Kept on this device for the read-only offline view (components/pwa); the install offer sits above the brief.
  return (
    <KeepOffline kind="home" {...keepOf(jar, session)} data={data}>
      <InstallPrompt />
      <OwnerHome data={data} edition={readEdition() === "paytm" ? <EditionSurfaces key="edition" /> : null} />
    </KeepOffline>
  );
}
