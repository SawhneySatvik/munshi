"use client";

// Live slots and a booking request: the branch, the service and the day pick the free start times the
// API computes from the roster; a time is held for ten minutes (POST /holds, with this browser's device token); the
// customer's details turn the hold into a request (POST /bookings) that a person at the salon confirms. Nothing here
// touches the books. Every price and duration is the API's cell with its source.
import type { IntFigure, MoneyFigure, Slot } from "@munshi/sdk";
import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Lang, Text } from "../lib/business.ts";
import { fill, refusal, ui } from "../lib/i18n.ts";
import { type Attempt, BOT_TOKEN, codeOf, keyFor, phoneOk } from "../lib/send.ts";
import { clock } from "../lib/time.ts";
import { live } from "../lib/variant.ts";
import { useApi } from "./Api.tsx";
import { Minutes, Money } from "./Figure.tsx";

export type BookService = { id: string; name: string; category: string | null; duration: IntFigure; price: MoneyFigure; shopIds: string[] };
type Held = { holdId: string; holdToken: string; expiresAt: string; slot: Slot };

const T = {
  branch: { en: "Branch", hi: "शाखा" },
  service: { en: "Service", hi: "सेवा" },
  day: { en: "Day", hi: "दिन" },
  time: { en: "Free times", hi: "खाली समय" },
  loading: { en: "Asking the salon's calendar…", hi: "सैलून का कैलेंडर देख रहे हैं…" },
  none: { en: "No free time that day. Try another day.", hi: "उस दिन कोई समय खाली नहीं। दूसरा दिन चुनें।" },
  slotsFailed: { en: "The calendar could not be read. Try again.", hi: "कैलेंडर पढ़ा नहीं जा सका। फिर कोशिश करें।" },
  with: { en: "with {name}", hi: "{name} के साथ" },
  hold: { en: "Hold {time}", hi: "{time} रोकें" },
  held: { en: "Held for you until {until}", hi: "{until} तक आपके लिए रुका है" },
  heldLine: { en: "{service} at {time}, {stylist}. Add your details to send the request.", hi: "{service}, {time}, {stylist}। अनुरोध भेजने के लिए अपनी जानकारी जोड़ें।" },
  bookedLine: { en: "{service} at {time}, {stylist}.", hi: "{service}, {time}, {stylist}।" },
  release: { en: "Let it go", hi: "छोड़ दें" },
  released: { en: "Released. Pick another time.", hi: "छोड़ दिया। दूसरा समय चुनें।" },
  send: { en: "Send booking request", hi: "बुकिंग अनुरोध भेजें" },
  sentTitle: { en: "Request received", hi: "अनुरोध मिल गया" },
  sentLine: {
    en: "The salon confirms your time on WhatsApp. Until a person there says yes, nothing is booked.",
    hi: "सैलून आपका समय WhatsApp पर पक्का करेगा। वहाँ कोई हाँ कहे, तब तक कुछ बुक नहीं है।",
  },
  another: { en: "Book another", hi: "एक और बुक करें" },
  stylistAny: { en: "Any stylist", hi: "कोई भी स्टाइलिस्ट" },
} satisfies Record<string, Text>;

export function Booking(props: {
  lang: Lang;
  shops: { id: string; name: string; area: string | null }[];
  services: BookService[];
  stylists: { id: string; shopId: string; displayName: string }[];
  days: { iso: string; label: string }[];
  versions: { notice: string; consent: string };
  initial: { shop: string | null; service: string | null };
}) {
  const { lang, shops, services, stylists, days, versions } = props;
  const { client, slug, writable } = useApi();
  const t = (k: keyof typeof T) => T[k][lang];
  const [shop, setShop] = useState(props.initial.shop ?? shops[0]?.id ?? "");
  const offered = services.filter((s) => s.shopIds.includes(shop));
  const [service, setService] = useState(props.initial.service ?? "");
  const chosen = offered.find((s) => s.id === service) ?? offered[0] ?? null;
  const [day, setDay] = useState(days[0]?.iso ?? "");
  const [slots, setSlots] = useState<Slot[] | "loading" | "failed">("loading");
  const [held, setHeld] = useState<Held | null>(null);
  const [sent, setSent] = useState<{ id: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [holdAttempt, setHoldAttempt] = useState<Attempt>(null);
  const [bookAttempt, setBookAttempt] = useState<Attempt>(null);
  const [form, setForm] = useState({ name: "", phone: "", note: "", whatsappUpdates: false, website: "" });
  const [errors, setErrors] = useState<{ name?: boolean; phone?: boolean }>({});
  const ids = useId();
  const nameField = useRef<HTMLInputElement>(null);
  const phoneField = useRef<HTMLInputElement>(null);
  const stylistName = (id: string) => stylists.find((s) => s.id === id)?.displayName ?? t("stylistAny");

  useEffect(() => {
    if (!chosen || !day || held || sent) return;
    let active = true;
    setSlots("loading");
    client
      .slots(slug, { shop, service: chosen.id, date: day })
      .then((r) => active && setSlots(r.slots))
      .catch(() => active && setSlots("failed"));
    return () => {
      active = false;
    };
  }, [client, slug, shop, chosen, day, held, sent]);

  async function hold(slot: Slot) {
    if (!chosen) return;
    const body = { shopId: shop, stylistId: slot.stylistId, serviceId: chosen.id, start: slot.start, shiftRel: slot.shiftRel, shiftId: slot.shiftId, botToken: BOT_TOKEN };
    const { key, next } = keyFor(holdAttempt, body);
    setHoldAttempt(next);
    setBusy(true);
    setMessage(null);
    try {
      const r = await client.hold(slug, body, { idempotencyKey: key });
      setHeld({ ...r, slot });
    } catch (err) {
      setMessage(refusal(codeOf(err), lang));
      if (codeOf(err) === "slot_taken") setSlots((s) => (Array.isArray(s) ? s.filter((x) => x !== slot) : s));
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    if (!held) return;
    setBusy(true);
    try {
      await client.releaseHold(slug, held.holdId, held.holdToken);
      setHeld(null);
      setHoldAttempt(null);
      setMessage(t("released"));
    } catch (err) {
      setMessage(refusal(codeOf(err), lang));
    } finally {
      setBusy(false);
    }
  }

  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!held) return;
    const bad = { name: form.name.trim() === "", phone: !phoneOk(form.phone) };
    // Rendered before the focus moves, so the field is announced with its error.
    flushSync(() => setErrors(bad));
    if (bad.name || bad.phone) {
      (bad.name ? nameField : phoneField).current?.focus();
      return;
    }
    const body = {
      holdId: held.holdId,
      holdToken: held.holdToken,
      name: form.name.trim(),
      phone: form.phone.trim(),
      ...(form.note.trim() ? { note: form.note.trim() } : {}),
      whatsappUpdates: form.whatsappUpdates,
      noticeVersion: versions.notice,
      consentVersion: versions.consent,
      botToken: BOT_TOKEN,
      website: form.website,
    };
    const { key, next } = keyFor(bookAttempt, body);
    setBookAttempt(next);
    setBusy(true);
    setMessage(null);
    try {
      const r = await client.book(slug, body, { idempotencyKey: key });
      setSent({ id: r.id });
    } catch (err) {
      setMessage(refusal(codeOf(err), lang));
    } finally {
      setBusy(false);
    }
  }

  if (sent && held) {
    return (
      <section className="answer" data-state="booked" aria-live="polite">
        <h2>{t("sentTitle")}</h2>
        <p>{fill(t("bookedLine"), { service: chosen?.name ?? "", time: clock(held.slot.start, lang), stylist: stylistName(held.slot.stylistId) })}</p>
        <p>{t("sentLine")}</p>
        <p className="ref-line">
          {ui.reference[lang]} <code data-kind="reference">{sent.id}</code>
        </p>
        {live ? null : <p className="demo-note">{ui.demoForm[lang]}</p>}
        <button
          type="button"
          className="btn"
          onClick={() => {
            setSent(null);
            setHeld(null);
            setHoldAttempt(null);
            setBookAttempt(null);
            setForm({ name: "", phone: "", note: "", whatsappUpdates: false, website: "" });
          }}
        >
          {t("another")}
        </button>
      </section>
    );
  }

  return (
    <div className="booking" data-state={held ? "held" : "choosing"}>
      {!writable ? <p className="note">{ui.noKey[lang]}</p> : null}
      <fieldset className="pick" disabled={held !== null}>
        <legend>{t("branch")}</legend>
        <div className="chips">
          {shops.map((s) => (
            <button key={s.id} type="button" className="chip" aria-pressed={s.id === shop} onClick={() => setShop(s.id)}>
              {s.name}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="pick" disabled={held !== null}>
        <legend>{t("service")}</legend>
        <label className="select">
          <span className="visually-hidden">{t("service")}</span>
          <select value={chosen?.id ?? ""} onChange={(e) => setService(e.target.value)}>
            {offered.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {chosen ? (
          <p className="chosen">
            <Minutes fig={chosen.duration} lang={lang} what={chosen.name} /> · <Money fig={chosen.price} lang={lang} what={chosen.name} />
          </p>
        ) : null}
      </fieldset>
      <fieldset className="pick" disabled={held !== null}>
        <legend>{t("day")}</legend>
        <div className="chips days">
          {days.map((d) => (
            <button key={d.iso} type="button" className="chip" aria-pressed={d.iso === day} onClick={() => setDay(d.iso)}>
              {d.label}
            </button>
          ))}
        </div>
      </fieldset>

      {held ? (
        <section className="held" data-state="held" aria-live="polite">
          <h2>{fill(t("held"), { until: clock(held.expiresAt, lang) })}</h2>
          <p>{fill(t("heldLine"), { service: chosen?.name ?? "", time: clock(held.slot.start, lang), stylist: stylistName(held.slot.stylistId) })}</p>
          <form className="form" onSubmit={book} noValidate>
            <label>
              <span>{ui.name[lang]}</span>
              <input
                ref={nameField}
                name="name"
                autoComplete="name"
                value={form.name}
                aria-invalid={errors.name || undefined}
                aria-describedby={errors.name ? `${ids}-name-err` : undefined}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              {errors.name ? (
                <span id={`${ids}-name-err`} className="err">
                  {ui.errName[lang]}
                </span>
              ) : null}
            </label>
            <label>
              <span>{ui.phone[lang]}</span>
              <input
                ref={phoneField}
                name="phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                value={form.phone}
                aria-invalid={errors.phone || undefined}
                aria-describedby={errors.phone ? `${ids}-phone-err` : undefined}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
              {errors.phone ? (
                <span id={`${ids}-phone-err`} className="err">
                  {ui.errPhone[lang]}
                </span>
              ) : null}
            </label>
            <label>
              <span>{ui.note[lang]}</span>
              <textarea name="note" rows={2} maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </label>
            <label className="tick">
              <input type="checkbox" checked={form.whatsappUpdates} onChange={(e) => setForm({ ...form, whatsappUpdates: e.target.checked })} />
              <span>{ui.whatsappUpdates[lang]}</span>
            </label>
            <label className="trap" aria-hidden="true" htmlFor={`${ids}-website`}>
              <input id={`${ids}-website`} tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            </label>
            <p className="fine">{ui.privacyLine[lang]}</p>
            {live ? null : <p className="demo-note">{ui.demoForm[lang]}</p>}
            <div className="actions">
              <button type="submit" className="btn btn-primary" disabled={busy || !writable}>
                {busy ? ui.sending[lang] : t("send")}
              </button>
              <button type="button" className="btn btn-ghost" onClick={release} disabled={busy}>
                {t("release")}
              </button>
            </div>
          </form>
        </section>
      ) : (
        <section className="slots" aria-live="polite">
          <h2>{t("time")}</h2>
          {slots === "loading" ? (
            <p className="muted">{t("loading")}</p>
          ) : slots === "failed" ? (
            <p className="err">{t("slotsFailed")}</p>
          ) : slots.length === 0 ? (
            <p className="muted">{t("none")}</p>
          ) : (
            <ul className="slot-list">
              {slots.slice(0, 24).map((s) => (
                <li key={`${s.stylistId}-${s.start}`}>
                  <button
                    type="button"
                    className="slot"
                    disabled={busy || !writable}
                    data-shift={`${s.shiftRel}:${s.shiftId}`}
                    aria-label={fill(t("hold"), { time: `${clock(s.start, lang)} ${fill(t("with"), { name: stylistName(s.stylistId) })}` })}
                    onClick={() => hold(s)}
                  >
                    <b>{clock(s.start, lang)}</b>
                    <span>{fill(t("with"), { name: stylistName(s.stylistId) })}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {message ? (
        <p className="message" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
