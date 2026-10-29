import type { ReactNode } from "react";
import { SITE_FACES } from "../../components/site/fonts";
import { SiteFrame } from "../../components/site/SiteFrame";

// Signed out: the product site's frame (its nav, the language, the statement of what is simulated) around the screen.
export default function Layout({ children }: { children: ReactNode }) {
  return <SiteFrame faces={SITE_FACES}>{children}</SiteFrame>;
}
