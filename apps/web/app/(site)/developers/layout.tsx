import type { ReactNode } from "react";
import { DevNav } from "../../../components/dev/DevNav";
import "../../../components/dev/dev.css";

// The developer portal, inside the product site's frame: built from docs/kit and openapi.json
// by `pnpm kit`, so nothing here reads a file or the database.
export default function DevelopersLayout({ children }: { children: ReactNode }) {
  return (
    <div className="d-wrap">
      <p className="d-kicker">Developers · API v1</p>
      <div className="d-grid">
        <DevNav />
        <article className="d-page">{children}</article>
      </div>
    </div>
  );
}
