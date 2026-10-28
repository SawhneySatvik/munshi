import business from "@business";
import type { CSSProperties } from "react";
import type { Lang, Text } from "../lib/business.ts";
import { duration, fill, href, ui } from "../lib/i18n.ts";
import { formatMoney } from "../lib/money.ts";
import { descOf, nameOf } from "../lib/page.ts";
import type { Offer, Plan, Product, Service, Shop } from "../lib/types.ts";
import { AddButton } from "./Tray.tsx";
import { Calendar, Chat, Check, Chevron, Clock, Pin } from "./Icons.tsx";

const copy = (key: string, lang: Lang): string => (business.profile.copy[key] as Text | undefined)?.[lang] ?? "";

export function BranchCard({ shop, lang, open }: { shop: Shop; lang: Lang; open: boolean }) {
  const name = lang === "hi" && shop.hi ? shop.hi.name : shop.name;
  const area = lang === "hi" && shop.hi ? shop.hi.area : shop.area;
  return (
    <article className="card branch">
      <h3 className="card-title display">{name}</h3>
      <p className="where">
        <Pin />
        {area}
      </p>
      <div className="chips">
        <span className="chip">
          <span className="dot" />
          {open ? copy("taking", lang) : copy("paused", lang)}
        </span>
        <span className="chip">
          <Chat />
          {copy("confirms", lang)}
        </span>
      </div>
      <a className="btn btn-primary" href={`${href(lang, "/book")}?branch=${shop.id}`}>
        {fill(copy("branchCta", lang), { branch: name })}
        <Chevron />
      </a>
    </article>
  );
}

export function PlanCard({ plan, lang }: { plan: Plan; lang: Lang }) {
  const validity = plan.validityDays.value >= 365 ? ui.validYear[lang] : fill(ui.validFor[lang], { n: plan.validityDays.value });
  return (
    <article className="card plan" id={plan.id}>
      <h3 className="card-title display">{nameOf(plan, lang)}</h3>
      <p className="muted">{descOf(plan, lang)}</p>
      <ul>
        {plan.lines.map((l) => (
          <li key={l.label}>
            <Check />
            <span>
              <strong>{l.sessions.value} ×</strong> {lang === "hi" && l.hi ? l.hi : l.label}
            </span>
          </li>
        ))}
      </ul>
      <div className="chips">
        <span className="chip">
          <Calendar />
          {validity}
        </span>
      </div>
      <div className="plan-price">
        <span className="price">{formatMoney(plan.price)}</span>
      </div>
      <a className="btn btn-outline" href={`${href(lang, "/book")}?plan=${plan.id}`}>
        {copy("planCta", lang)}
      </a>
    </article>
  );
}

/** A package on the home page: name, what it holds, price; the full card lives on /packages. */
export function PlanTeaser({ plan, lang }: { plan: Plan; lang: Lang }) {
  const holds = plan.lines.map((l) => `${l.sessions.value} × ${lang === "hi" && l.hi ? l.hi : l.label}`).join(" · ");
  return (
    <a className="card teaser" href={`${href(lang, "/packages")}#${plan.id}`}>
      <h3 className="card-title display">{nameOf(plan, lang)}</h3>
      <p className="muted">{holds}</p>
      <p className="teaser-foot">
        <span className="price">{formatMoney(plan.price)}</span>
        <Chevron />
      </p>
    </a>
  );
}

export function OfferCard({ offer, lang }: { offer: Offer; lang: Lang }) {
  const t = lang === "hi" && offer.hi ? offer.hi : offer;
  return (
    <article className="offer">
      <h3 className="display">{t.title}</h3>
      <p>{t.detail}</p>
      <p className="until">
        <Clock />
        {t.until}
      </p>
    </article>
  );
}

/** The lowest price among a product's variants. */
export function fromPrice(p: Product) {
  return p.variants.reduce((a, v) => (v.price.minor < a.minor ? v.price : a), p.variants[0]?.price ?? { minor: 0, currency: "INR" as const, ref: null, source: null });
}

export function ProductCard({ product, lang }: { product: Product; lang: Lang }) {
  const { art } = business;
  const first = product.variants[0];
  const colours = [...new Map(product.variants.map((v) => [v.attrs.colour, v.attrs.swatch])).entries()];
  const price = fromPrice(product);
  const sizes = new Set(product.variants.map((v) => v.attrs.size));
  const varies = product.variants.some((v) => v.price.minor !== price.minor);
  return (
    <a className="card product" href={href(lang, `/catalogue/${product.id}`)}>
      <span className="art" style={{ "--c1": first?.attrs.swatch, "--c2": art.trimFor(first?.attrs.swatch ?? "") } as CSSProperties}>
        <art.Product category={product.category} />
        <span className="stand-in" title={ui.standIn[lang]}>
          {ui.standInShort[lang]}
        </span>
      </span>
      <h3>{nameOf(product, lang)}</h3>
      <p className="fabric">{lang === "hi" && product.hi?.fabric ? product.hi.fabric : product.fabric}</p>
      <span className="row">
        <span className="price">{varies || sizes.size > 1 ? fill(ui.from[lang], { price: formatMoney(price) }) : formatMoney(price)}</span>
        <span className="swatches" role="img" aria-label={colours.map(([c]) => c).join(", ")}>
          {colours.slice(0, 4).map(([c, hex]) => (
            <span key={c} className="swatch" style={{ background: hex }} />
          ))}
          {colours.length > 4 ? <span className="more">+{colours.length - 4}</span> : null}
        </span>
      </span>
    </a>
  );
}

export function ServiceCard({ service, lang }: { service: Service; lang: Lang }) {
  const { art } = business;
  const name = nameOf(service, lang);
  const price = formatMoney(service.price);
  return (
    <article className="card item">
      <span className="icon">
        <art.Icon id={service.category} />
      </span>
      <h3>{name}</h3>
      <p className="desc">{descOf(service, lang)}</p>
      <div className="item-foot">
        <p>
          <span className="price">{service.from ? fill(ui.from[lang], { price }) : price}</span>
          <span className="price-note">
            <Clock />
            {duration(service.duration.value, lang)}
          </span>
        </p>
        <AddButton id={service.id} name={name} labels={{ add: ui.add[lang], remove: ui.remove[lang] }} />
      </div>
    </article>
  );
}
