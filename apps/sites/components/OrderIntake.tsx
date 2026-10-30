"use client";

// The order intake (BLUEPRINT §8.5): the pieces in this browser's order, each with its published price cell and the
// customer's own quantity, sent as POST /orders under one Idempotency-Key per attempt (a retry after a lost answer is
// the same request). The page computes no figure: the line amounts and the total appear only as the API's answer gives
// them, each with the cells it was worked out from. The answer's ORD- code opens the order's status page. The order is
// the shop's to confirm; nothing here writes the books (the API stores an ops request with no personal data).
import type { MoneyFigure, OrderCreated } from "@munshi/sdk";
import { useState } from "react";
import type { Lang, Text } from "../lib/business.ts";
import { MAX_UNITS, useCart } from "../lib/cart.ts";
import { fill, href, refusal } from "../lib/i18n.ts";
import { type Attempt, codeOf, keyFor } from "../lib/send.ts";
import { useApi } from "./Api.tsx";
import { Money } from "./Figure.tsx";

export type OrderItem = { id: string; name: string; price: MoneyFigure };

const T = {
  empty: { en: "Your order is empty. Add pieces from the catalogue.", hi: "आपका ऑर्डर खाली है। कैटलॉग से पीस जोड़ें।" },
  browse: { en: "Open the catalogue", hi: "कैटलॉग खोलें" },
  qty: { en: "You asked for {n}", hi: "आपने {n} माँगे" },
  more: { en: "One more {name}", hi: "एक और {name}" },
  less: { en: "One fewer {name}", hi: "एक कम {name}" },
  each: { en: "each", hi: "हर एक" },
  code: { en: "Offer code (optional)", hi: "ऑफ़र कोड (ज़रूरी नहीं)" },
  codeBad: { en: "A code is 4 to 16 capital letters or digits.", hi: "कोड 4 से 16 बड़े अक्षर या अंक होता है।" },
  codeLine: { en: "Sent as you typed it: the shop checks it when it confirms.", hi: "जैसा लिखा वैसा भेजा जाएगा: पुष्टि करते समय दुकान जाँचेगी।" },
  send: { en: "Send order to the shop", hi: "ऑर्डर दुकान को भेजें" },
  sending: { en: "Sending…", hi: "भेज रहे हैं…" },
  sendLine: {
    en: "The order carries no name or number: only the pieces and an order code. The shop confirms it, and only then is it an order.",
    hi: "ऑर्डर में कोई नाम या नंबर नहीं जाता: सिर्फ़ पीस और एक ऑर्डर कोड। दुकान पुष्टि करे, तभी यह ऑर्डर बनता है।",
  },
  sentTitle: { en: "Order sent", hi: "ऑर्डर भेज दिया" },
  sentLine: { en: "Keep this code. The shop confirms the order and its prices; the status page shows each step.", hi: "यह कोड रखें। दुकान ऑर्डर और दाम पक्के करेगी; स्टेटस पेज हर कदम दिखाएगा।" },
  total: { en: "Total at today's published prices", hi: "आज के छपे दामों पर कुल" },
  status: { en: "See the order's status", hi: "ऑर्डर का स्टेटस देखें" },
  whatsapp: { en: "Send it to the shop on WhatsApp", hi: "WhatsApp पर दुकान को भेजें" },
  offerSent: { en: "Offer code {code}: to be checked at the shop", hi: "ऑफ़र कोड {code}: दुकान पर जाँचा जाएगा" },
  unknown: { en: "No longer in the catalogue", hi: "अब कैटलॉग में नहीं" },
  remove: { en: "Remove", hi: "हटाएँ" },
} satisfies Record<string, Text>;

export function OrderIntake({ lang, shopId, items }: { lang: Lang; shopId: string; items: OrderItem[] }) {
  const t = (k: keyof typeof T) => T[k][lang];
  const { client, slug, writable } = useApi();
  const { cart, set, clear } = useCart();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<Attempt>(null);
  const [answer, setAnswer] = useState<OrderCreated | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const byId = new Map(items.map((i) => [i.id, i]));
  const lines = Object.entries(cart).filter(([id]) => byId.has(id));
  const gone = Object.keys(cart).filter((id) => !byId.has(id));
  const codeBad = code !== "" && !/^[A-Z0-9]{4,16}$/.test(code);

  async function send() {
    if (!lines.length || codeBad) return;
    const body = { shopId, channel: "site" as const, lines: lines.map(([itemId, units]) => ({ itemId, qtyMilli: units * 1000 })), ...(code ? { offerCode: code } : {}) };
    const { key, next } = keyFor(attempt, body);
    setAttempt(next);
    setBusy(true);
    setMessage(null);
    try {
      const r = await client.order(slug, body, { idempotencyKey: key });
      setAnswer(r);
      clear();
      setAttempt(null);
    } catch (err) {
      setMessage(refusal(codeOf(err), lang));
    } finally {
      setBusy(false);
    }
  }

  if (answer) {
    return (
      <section className="answer order-answer" data-state="ordered" aria-live="polite">
        <h2>{t("sentTitle")}</h2>
        <p className="order-code">
          <code data-kind="code">{answer.code}</code>
        </p>
        <p>{t("sentLine")}</p>
        <ul className="lines">
          {answer.lines.map((l) => (
            <li key={l.itemId}>
              <span className="line-name">{byId.get(l.itemId)?.name ?? t("unknown")}</span>
              <span className="line-qty" data-source="request">
                {fill(t("qty"), { n: l.qty.qtyMilli / 1000 })}
              </span>
              <span className="line-price">
                <Money fig={l.price} lang={lang} what={byId.get(l.itemId)?.name ?? ""} /> {t("each")}
              </span>
              <span className="line-amount">
                <Money fig={l.amount} lang={lang} what={byId.get(l.itemId)?.name ?? ""} />
              </span>
            </li>
          ))}
        </ul>
        <p className="total">
          <span>{t("total")}</span>
          <Money fig={answer.total} lang={lang} what={t("total")} />
        </p>
        {answer.offerCode ? <p className="fine">{fill(t("offerSent"), { code: answer.offerCode })}</p> : null}
        <div className="actions">
          <a className="btn btn-primary" href={href(lang, `/order/${answer.code}`)}>
            {t("status")}
          </a>
          {answer.waLink ? (
            <a className="btn" href={answer.waLink} target="_blank" rel="noopener">
              {t("whatsapp")}
            </a>
          ) : null}
        </div>
      </section>
    );
  }

  if (!lines.length) {
    return (
      <section className="empty" data-state="empty">
        <p>{t("empty")}</p>
        <a className="btn" href={href(lang, "/catalogue")}>
          {t("browse")}
        </a>
        {gone.length ? (
          <button type="button" className="btn btn-ghost" onClick={clear}>
            {t("remove")}
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <div className="order-form" data-state="cart">
      <ul className="lines">
        {lines.map(([id, units]) => {
          const item = byId.get(id) as OrderItem;
          return (
            <li key={id}>
              <span className="line-name">{item.name}</span>
              <span className="line-price">
                <Money fig={item.price} lang={lang} what={item.name} /> {t("each")}
              </span>
              <span className="qty" role="group">
                <button type="button" aria-label={fill(t("less"), { name: item.name })} onClick={() => set(id, units - 1)}>
                  −
                </button>
                <span className="line-qty" data-source="request">
                  {fill(t("qty"), { n: units })}
                </span>
                <button type="button" aria-label={fill(t("more"), { name: item.name })} disabled={units >= MAX_UNITS} onClick={() => set(id, units + 1)}>
                  +
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <label className="code-field">
        <span>{t("code")}</span>
        <input value={code} maxLength={16} autoCapitalize="characters" aria-invalid={codeBad || undefined} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ""))} />
        <span className={codeBad ? "err" : "fine"}>{codeBad ? t("codeBad") : t("codeLine")}</span>
      </label>
      <p className="fine">{t("sendLine")}</p>
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={busy || !writable || codeBad} onClick={send}>
          {busy ? t("sending") : t("send")}
        </button>
      </div>
      {message ? (
        <p className="message" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
