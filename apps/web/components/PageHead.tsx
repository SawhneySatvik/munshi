import type { ReactNode } from "react";
// The owner home's ruled strip (OwnerHome.css): the shop's page in the ledger, a red margin rule, full bleed on a phone.
import "./OwnerHome.css";

/** A page's head in the reference's ledger strip: what and where, the page's name, and (on a desk) one line of lede. */
export function PageHead({ id, kicker, title, lede }: { id: string; kicker: ReactNode; title: ReactNode; lede: ReactNode }) {
  return (
    <section className="shop" aria-labelledby={id}>
      <p className="kicker shop-kicker">{kicker}</p>
      <h1 id={id}>{title}</h1>
      <p className="shop-lede">{lede}</p>
    </section>
  );
}
