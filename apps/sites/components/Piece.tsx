"use client";

// One product and its pieces (each piece a catalogue variant with its own price cell): colour and size as choices, the
// chosen piece's price with its source, and the two asks a release may switch on. "Hold it for your visit" (`holds`)
// stores one ops.reservation the shop answers; "Add to my order" (`orders`) puts the piece in this browser's order,
// which is sent from the order page. Neither moves stock or writes the books.
import type { MoneyFigure } from "@munshi/sdk";
import { useId, useState } from "react";
import type { Lang, Text } from "../lib/business.ts";
import { useCart } from "../lib/cart.ts";
import { href, refusal, ui } from "../lib/i18n.ts";
import { type Attempt, BOT_TOKEN, codeOf, keyFor, phoneOk } from "../lib/send.ts";
import { live } from "../lib/variant.ts";
import { useApi } from "./Api.tsx";
import { Money } from "./Figure.tsx";

export type PieceOption = { id: string; name: string; options: string[]; price: MoneyFigure; held: boolean };

const T = {
  colour: { en: "Colour", hi: "रंग" },
  size: { en: "Size", hi: "साइज़" },
  heldBySomeone: { en: "On hold for another customer just now.", hi: "अभी किसी और ग्राहक के लिए रुका है।" },
  hold: { en: "Hold it for your visit", hi: "आने तक रखवाइए" },
  holdLine: { en: "The shop answers on WhatsApp. Nothing is set aside until it says yes.", hi: "दुकान WhatsApp पर जवाब देगी। उसकी हाँ से पहले कुछ अलग नहीं रखा जाता।" },
  askHold: { en: "Ask the shop to hold it", hi: "दुकान से रखवाने को कहें" },
  holdSent: { en: "Asked to hold: waiting for the shop's yes", hi: "रखवाने को कहा: दुकान की हाँ का इंतज़ार" },
  add: { en: "Add to my order", hi: "मेरे ऑर्डर में जोड़ें" },
  inOrder: { en: "In your order: {n}", hi: "आपके ऑर्डर में: {n}" },
  seeOrder: { en: "See my order", hi: "मेरा ऑर्डर देखें" },
  cancel: { en: "Cancel", hi: "रद्द करें" },
} satisfies Record<string, Text>;

export function Piece(props: {
  lang: Lang;
  title: string;
  pieces: PieceOption[];
  caps: { holds: boolean; orders: boolean };
  versions: { notice: string; consent: string };
  swatches: Record<string, string>;
}) {
  const { lang, pieces, caps, versions, swatches } = props;
  const t = (k: keyof typeof T) => T[k][lang];
  const { client, slug, writable } = useApi();
  const { cart, set } = useCart();
  const [chosen, setChosen] = useState(pieces.find((p) => !p.held)?.id ?? pieces[0]?.id ?? "");
  const piece = pieces.find((p) => p.id === chosen) ?? pieces[0];
  const [asking, setAsking] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", note: "", website: "" });
  const [errors, setErrors] = useState<{ name?: boolean; phone?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<Attempt>(null);
  const [sent, setSent] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const ids = useId();
  if (!piece) return null;

  // The choice axes: the first option is the colour, the second (when there is one) the size.
  const colours = [...new Set(pieces.map((p) => p.options[0]).filter((x): x is string => !!x))];
  const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "Free size"];
  const rank = (x: string) => SIZE_ORDER.indexOf(x) + 1 || 99;
  const sizes = [...new Set(pieces.map((p) => p.options[1]).filter((x): x is string => !!x))].sort((a, b) => rank(a) - rank(b));
  const pick = (colour: string | undefined, size: string | undefined) => {
    const exact = pieces.find((p) => p.options[0] === colour && p.options[1] === size);
    const near = pieces.find((p) => p.options[0] === colour) ?? pieces.find((p) => p.options[1] === size);
    const next = exact ?? near;
    if (next) {
      setChosen(next.id);
      setAsking(false);
      setMessage(null);
    }
  };

  async function askHold(e: React.FormEvent) {
    e.preventDefault();
    if (!piece) return;
    const bad = { name: form.name.trim() === "", phone: !phoneOk(form.phone) };
    setErrors(bad);
    if (bad.name || bad.phone) return;
    const body = {
      itemId: piece.id,
      qtyMilli: 1000,
      name: form.name.trim(),
      phone: form.phone.trim(),
      ...(form.note.trim() ? { note: form.note.trim() } : {}),
      noticeVersion: versions.notice,
      consentVersion: versions.consent,
      botToken: BOT_TOKEN,
      website: form.website,
    };
    const { key, next } = keyFor(attempt, body);
    setAttempt(next);
    setBusy(true);
    setMessage(null);
    try {
      const r = await client.reserve(slug, body, { idempotencyKey: key });
      setSent({ ...sent, [piece.id]: r.id });
      setAsking(false);
    } catch (err) {
      setMessage(refusal(codeOf(err), lang));
    } finally {
      setBusy(false);
    }
  }

  const units = cart[piece.id] ?? 0;
  return (
    <div className="piece-choose" data-piece={piece.id}>
      <p className="piece-price">
        <Money fig={piece.price} lang={lang} what={piece.name} />
        <span className="fine">{ui.inclGst[lang]}</span>
      </p>
      {colours.length ? (
        <div className="choice">
          <p className="choice-label">
            {t("colour")} <b>{piece.options[0]}</b>
          </p>
          <fieldset className="swatches" aria-label={t("colour")}>
            {colours.map((c) => (
              <button
                key={c}
                type="button"
                className="swatch"
                aria-pressed={piece.options[0] === c}
                aria-label={c}
                style={{ "--sw": swatches[c] ?? "#8a7f86" } as React.CSSProperties}
                onClick={() => pick(c, piece.options[1])}
              >
                <span aria-hidden="true" />
              </button>
            ))}
          </fieldset>
        </div>
      ) : null}
      {sizes.length ? (
        <div className="choice">
          <p className="choice-label">
            {t("size")} <b>{piece.options[1]}</b>
          </p>
          <fieldset className="tape" aria-label={t("size")}>
            {sizes.map((s) => {
              const there = pieces.some((p) => p.options[0] === piece.options[0] && p.options[1] === s);
              return (
                <button key={s} type="button" className="tape-mark" aria-pressed={piece.options[1] === s} disabled={!there} onClick={() => pick(piece.options[0], s)}>
                  {s}
                </button>
              );
            })}
          </fieldset>
        </div>
      ) : null}

      {piece.held ? <p className="held-note">{t("heldBySomeone")}</p> : null}
      {!writable && (caps.holds || caps.orders) ? <p className="note">{ui.noKey[lang]}</p> : null}

      <div className="asks">
        {caps.holds ? (
          sent[piece.id] ? (
            <section className="answer" data-state="hold-asked" aria-live="polite">
              <h3>{t("holdSent")}</h3>
              <p>{t("holdLine")}</p>
              <p className="ref-line">
                {ui.reference[lang]} <code data-kind="reference">{sent[piece.id]}</code>
              </p>
              {live ? null : <p className="demo-note">{ui.demoForm[lang]}</p>}
            </section>
          ) : asking ? (
            <form className="form" onSubmit={askHold} noValidate data-state="holding">
              <h3>{t("hold")}</h3>
              <p className="fine">{t("holdLine")}</p>
              <label>
                <span>{ui.name[lang]}</span>
                <input name="name" autoComplete="name" value={form.name} aria-invalid={errors.name || undefined} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                {errors.name ? <span className="err">{ui.errName[lang]}</span> : null}
              </label>
              <label>
                <span>{ui.phone[lang]}</span>
                <input
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={form.phone}
                  aria-invalid={errors.phone || undefined}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
                {errors.phone ? <span className="err">{ui.errPhone[lang]}</span> : null}
              </label>
              <label>
                <span>{ui.note[lang]}</span>
                <textarea name="note" rows={2} maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </label>
              <label className="trap" aria-hidden="true" htmlFor={`${ids}-website`}>
                <input id={`${ids}-website`} tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              </label>
              <p className="fine">{ui.privacyLine[lang]}</p>
              {live ? null : <p className="demo-note">{ui.demoForm[lang]}</p>}
              <div className="actions">
                <button type="submit" className="btn btn-primary" disabled={busy || !writable}>
                  {busy ? ui.sending[lang] : t("askHold")}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setAsking(false)}>
                  {t("cancel")}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="btn btn-primary" disabled={piece.held || !writable} onClick={() => setAsking(true)}>
              {t("hold")}
            </button>
          )
        ) : null}
        {caps.orders ? (
          <div className="add">
            <button type="button" className="btn" disabled={units >= 9} onClick={() => set(piece.id, units + 1)}>
              {t("add")}
            </button>
            {units ? (
              <a className="in-order" href={href(lang, "/order")}>
                {t("inOrder").replace("{n}", String(units))} · {t("seeOrder")}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
      {message ? (
        <p className="message" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
