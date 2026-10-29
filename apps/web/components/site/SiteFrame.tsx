import type { ReactNode } from "react";
import { SiteFoot } from "./SiteFoot";
import { SiteNav } from "./SiteNav";
import "./site.css";

/**
 * The site's page: the dark ground, the floating nav, the page, the foot. `faces` carries the class names of the site's
 * two self-hosted faces (Gabarito, Akshar); only layouts load them, so tests render the frame without next/font.
 */
export function SiteFrame({ faces = "", children }: { faces?: string; children: ReactNode }) {
  return (
    <div className={`site ${faces}`.trim()}>
      <SiteNav />
      <main id="s-main" className="s-main">
        {children}
      </main>
      <SiteFoot />
    </div>
  );
}
