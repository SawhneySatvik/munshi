import type { ConsoleShop } from "@munshi/core";
import Link from "next/link";
import { Sticker } from "../Sticker";
import { onOff, SetBy, when, yesNo } from "./Console";

const NONE_SHOP = "no approved change has set this shop's config: AI is off and the site hidden (a new shop's default).";

/** One shop as the console lists it: who it is, and each setting beside the change that set it. */
export function ShopCard({ shop, link = true }: { shop: ConsoleShop; link?: boolean }) {
  const l = shop.limits;
  const via = l.source === "default" ? " (the demo default config)" : l.source === "shop" ? " (this shop's config)" : "";
  return (
    <article className="l-card" aria-labelledby={`shop-${shop.tenantId}`}>
      <div className="pc-card-h">
        <h2 id={`shop-${shop.tenantId}`}>{link ? <Link href={`/platform/shops/${shop.tenantId}`}>{shop.name}</Link> : shop.name}</h2>
        <span className="pc-meta">{shop.slug}</span>
        <Sticker tone={shop.dataClass === "live" ? "ink" : "yellow"}>{shop.sandbox ? "Sandbox" : shop.dataClass === "live" ? "Live" : shop.dataClass === "showcase" ? "Showcase (synthetic)" : "Synthetic"}</Sticker>
      </div>
      <div className="l-row">
        <div>
          Business type
          <div className="l-sub">Created {when(shop.createdAt)}</div>
        </div>
        <span className="pc-row-v">{shop.businessType}</span>
      </div>
      <div className="l-row">
        <div>
          Site verified
          {l.source === "shop" ? <SetBy from={l.from} none={NONE_SHOP} /> : <SetBy from={null} none="no approved change has verified this site: it stays hidden." />}
        </div>
        <span className="pc-row-v">{yesNo(l.siteVerified)}</span>
      </div>
      <div className="l-row">
        <div>
          AI{via}
          <SetBy from={l.from} none={NONE_SHOP} />
        </div>
        <span className="pc-row-v">{onOff(l.aiEnabled)}</span>
      </div>
      <div className="l-row">
        <div>
          Text calls today
          <div className="l-sub">used of the cap · the AI allowance's own count, {shop.usage.day}</div>
        </div>
        <span className="pc-row-v">
          {shop.usage.text} of {l.aiDailyCalls}
        </span>
      </div>
      <div className="l-row">
        <div>
          Media calls today
          <div className="l-sub">used of the cap · the AI allowance's own count, {shop.usage.day}</div>
        </div>
        <span className="pc-row-v">
          {shop.usage.media} of {l.mediaDailyCalls}
        </span>
      </div>
      {shop.grants.map((g) => (
        <div className="l-row" key={g.channel}>
          <div>
            {g.channel === "whatsapp" ? "WhatsApp" : "Instagram"} grant
            {g.channel === "whatsapp" && g.granted ? <div className="l-sub">up to {g.maxTestRecipients} test recipients</div> : null}
            {g.accountRef ? <div className="l-sub">account {g.accountRef}</div> : null}
            <SetBy from={g.from} none="no approved change has granted this channel: no real send." />
          </div>
          <span className="pc-row-v">{g.granted ? "Granted" : "None"}</span>
        </div>
      ))}
    </article>
  );
}
