import { render } from "@testing-library/react";
import { LangProvider } from "../components/LangProvider";
import { OwnerHome } from "../components/OwnerHome";
import { TopBar } from "../components/TopBar";
import { sharmaHome } from "../lib/fixture";
import type { Lang, OwnerHome as OwnerHomeData } from "../lib/types";

/** The shell as the root layout composes it: the top bar, then the owner home, under one language provider. */
export function renderHome(lang: Lang = "en", data: OwnerHomeData = sharmaHome) {
  return render(
    <LangProvider initial={lang}>
      <TopBar />
      <OwnerHome data={data} />
    </LangProvider>,
  );
}

/** jsdom has no matchMedia; the drawer asks it whether to open as an overlay. `phone` answers yes. */
export function fakeMatchMedia(phone: boolean) {
  return (query: string) => ({ matches: phone, media: query, addEventListener() {}, removeEventListener() {} });
}
