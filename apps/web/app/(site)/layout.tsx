import type { ReactNode } from "react";
import { SITE_FACES } from "../../components/site/fonts";
import { SiteFrame } from "../../components/site/SiteFrame";

// The product site's pages: the home, how it works, and sign-up.
export default function SiteLayout({ children }: { children: ReactNode }) {
  return <SiteFrame faces={SITE_FACES}>{children}</SiteFrame>;
}
