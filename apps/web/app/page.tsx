import { OwnerHome } from "../components/OwnerHome";
import { sharmaHome } from "../lib/fixture";

// TODO(core): read the owner home from core (findings, the waiting draft and their snapshots) in place of the fixture.
export default function Page() {
  return <OwnerHome data={sharmaHome} />;
}
