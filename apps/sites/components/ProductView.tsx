"use client";

import { type CSSProperties, type ReactNode, useState } from "react";
import { fill } from "../lib/i18n.ts";
import { formatMoney } from "../lib/money.ts";
import { whatsappLink } from "../lib/whatsapp.ts";
import { Chat, Clock } from "./Icons.tsx";

export type ProductStrings = Record<
  "colour" | "size" | "fabric" | "inclGst" | "samplePrices" | "sampleOffer" | "standIn" | "ask" | "askNote" | "prefill" | "prefillSize" | "from",
  string
>;

type Props = {
  art: ReactNode;
  kind: string;
  name: string;
  description: string;
  fabric: string;
  colours: { name: string; swatch: string; trim: string }[];
  sizes: string[] | null;
  sizeNote: string | null;
  variants: { colour: string; size: string | null; minor: number }[];
  offer: { title: string; detail: string; until: string } | null;
  whatsapp: string | null;
  sample: boolean;
  t: ProductStrings;
};

export function ProductView(p: Props) {
  const { t } = p;
  const [colour, setColour] = useState(p.colours[0]?.name ?? "");
  const [size, setSize] = useState<string | null>(p.sizes?.length === 1 ? (p.sizes[0] ?? null) : null);
  const current = p.colours.find((c) => c.name === colour) ?? p.colours[0];
  const match = p.variants.find((v) => v.colour === colour && (v.size === size || !p.sizes));
  const low = Math.min(...p.variants.filter((v) => v.colour === colour).map((v) => v.minor));
  const varies = new Set(p.variants.filter((v) => v.colour === colour).map((v) => v.minor)).size > 1;
  const price = formatMoney({ minor: match?.minor ?? low, currency: "INR", ref: null, source: null });
  const message = fill(t.prefill, { product: p.name, colour, size: size && p.sizes && p.sizes.length > 1 ? fill(t.prefillSize, { size }) : "" });

  return (
    <div className="pdp">
      <div className="pdp-art" style={{ "--c1": current?.swatch, "--c2": current?.trim } as CSSProperties}>
        {p.art}
        <span className="stand-in">{t.standIn}</span>
      </div>
      <div className="pdp-info">
        <p className="pill">{p.kind}</p>
        <h1 className="pdp-title display">{p.name}</h1>
        <p className="muted pdp-desc">{p.description}</p>
        <p className="pdp-price">
          <span className="price">{!match && varies ? fill(t.from, { price }) : price}</span>
          <span className="muted">{t.inclGst}</span>
          {p.sample ? <span className="chip chip-sample">{t.samplePrices}</span> : null}
        </p>

        <fieldset className="field">
          <legend>
            {t.colour}: <span className="muted">{colour}</span>
          </legend>
          <div className="pills">
            {p.colours.map((c) => (
              <label key={c.name} className="pick swatch-pick">
                <input type="radio" name="colour" value={c.name} checked={colour === c.name} onChange={() => setColour(c.name)} />
                <span>
                  <i className="swatch" style={{ background: c.swatch }} />
                  {c.name}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {p.sizes && p.sizes.length > 1 ? (
          <fieldset className="field">
            <legend>{t.size}</legend>
            <div className="pills">
              {p.sizes.map((s) => (
                <label key={s} className="pick size-pick">
                  <input type="radio" name="size" value={s} checked={size === s} onChange={() => setSize(s)} />
                  <span>{s}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="pdp-note">
            <strong>{t.size}:</strong> {p.sizes?.[0] ?? p.sizeNote}
          </p>
        )}

        <dl className="pdp-facts">
          <div>
            <dt>{t.fabric}</dt>
            <dd>{p.fabric}</dd>
          </div>
        </dl>

        {p.offer ? (
          <div className="offer offer-small">
            <h2 className="display">{p.offer.title}</h2>
            {p.sample ? <span className="chip chip-sample">{t.sampleOffer}</span> : null}
            <p>{p.offer.detail}</p>
            <p className="until">
              <Clock />
              {p.offer.until}
            </p>
          </div>
        ) : null}

        <a className="btn btn-primary btn-block" href={whatsappLink(p.whatsapp, message)} target="_blank" rel="noopener">
          <Chat />
          {t.ask}
        </a>
        <p className="fine">{t.askNote}</p>
      </div>
    </div>
  );
}
