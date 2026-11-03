import type { ReactNode } from "react";
import "./PageHead.css";

/** A page's head: its name on one line with where it is (the shop) beside it, and on a desk one short line of lede. It
 *  spans the page's columns, above the record and the entry sheet. */
export function PageHead({ id, kicker, title, lede }: { id: string; kicker: ReactNode; title: ReactNode; lede: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-row">
        <h1 id={id}>{title}</h1>
        <p className="page-where">{kicker}</p>
      </div>
      <p className="page-lede">{lede}</p>
    </header>
  );
}
