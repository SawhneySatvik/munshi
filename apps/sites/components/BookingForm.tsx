"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { duration, fill } from "../lib/i18n.ts";
import { formatMoney } from "../lib/money.ts";
import { requestBooking } from "../lib/request.ts";
import { Check, Chevron, Cross } from "./Icons.tsx";
import { readTray, TRAY_MAX, type TrayService, writeTray } from "./Tray.tsx";

type Window = "morning" | "afternoon" | "evening";
type Field = "branch" | "services" | "day" | "time" | "name" | "phone";

export type BookingStrings = Record<
  | "stepBranch"
  | "stepWhen"
  | "stepYou"
  | "yourServices"
  | "noServices"
  | "chooseServices"
  | "changeServices"
  | "askingAbout"
  | "day"
  | "timeOfDay"
  | "anotherDay"
  | "pickDate"
  | "morning"
  | "afternoon"
  | "evening"
  | "yourName"
  | "phone"
  | "phoneHint"
  | "note"
  | "consent"
  | "consentHint"
  | "privacyLine"
  | "privacy"
  | "demoForm"
  | "send"
  | "sending"
  | "confirmsOn"
  | "errBranch"
  | "errServices"
  | "errDay"
  | "errDate"
  | "errTime"
  | "errName"
  | "errPhone"
  | "errSummary"
  | "sentTitle"
  | "sentDemo"
  | "sentRef"
  | "backHome"
  | "another"
  | "remove"
  | "from"
  | "samplePrices",
  string
>;

export type BookingProps = {
  lang: "en" | "hi";
  t: BookingStrings;
  shops: { id: string; name: string; area: string }[];
  services: TrayService[];
  days: { iso: string; label: string }[];
  minDate: string;
  maxDate: string;
  initial: { branch: string | null; ids: string[] | null; plan: { id: string; name: string } | null };
  versions: { consent: string; notice: string };
  links: { home: string; services: string; privacy: string };
  demo: boolean;
  sample: boolean;
};

const PHONE = /^[6-9]\d{9}$/;

/** "+91 98100 12345", "098100 12345" and "9810012345" are the same number. */
function digitsOf(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}

export function BookingForm(p: BookingProps) {
  const { t } = p;
  const [branch, setBranch] = useState(p.initial.branch ?? "");
  const [ids, setIds] = useState<string[]>(p.initial.ids ?? []);
  const [day, setDay] = useState("");
  const [other, setOther] = useState(false);
  const [time, setTime] = useState<Window | "">("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState(p.initial.plan ? `${t.askingAbout}: ${p.initial.plan.name}` : "");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [ref, setRef] = useState("");
  const key = useRef<string | null>(null);
  const summary = useRef<HTMLParagraphElement>(null);

  // With no services in the link, carry over what the menu's tray holds.
  useEffect(() => {
    if (p.initial.ids === null) setIds(readTray().filter((id) => p.services.some((s) => s.id === id)));
  }, [p.initial.ids, p.services]);

  const chosen = ids.map((id) => p.services.find((s) => s.id === id)).filter((s) => s !== undefined);
  const minutes = chosen.reduce((a, s) => a + s.minutes, 0);
  const total = formatMoney({ minor: chosen.reduce((a, s) => a + s.minor, 0), currency: "INR", ref: null, source: null });
  const money = (minor: number) => formatMoney({ minor, currency: "INR", ref: null, source: null });

  function removeService(id: string) {
    const next = ids.filter((x) => x !== id);
    setIds(next);
    writeTray(next);
  }

  function validate(): Partial<Record<Field, string>> {
    const e: Partial<Record<Field, string>> = {};
    if (!p.shops.some((s) => s.id === branch)) e.branch = t.errBranch;
    if (!chosen.length && !p.initial.plan) e.services = t.errServices;
    if (!day) e.day = t.errDay;
    else if (day < p.minDate || day > p.maxDate) e.day = t.errDate;
    if (!time) e.time = t.errTime;
    if (!name.trim() || name.trim().length > 80) e.name = t.errName;
    if (!PHONE.test(digitsOf(phone))) e.phone = t.errPhone;
    return e;
  }

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    if ((form.elements.namedItem("website") as HTMLInputElement | null)?.value) return;
    const e = validate();
    setErrors(e);
    const first = (["branch", "services", "day", "time", "name", "phone"] as Field[]).find((f) => e[f]);
    if (first) {
      summary.current?.focus();
      document.getElementById(`f-${first}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    setStatus("sending");
    key.current ??= crypto.randomUUID();
    const res = await requestBooking(
      {
        shopId: branch,
        name: name.trim(),
        phone: `+91${digitsOf(phone)}`,
        serviceIds: ids.slice(0, TRAY_MAX),
        preferredOn: day,
        timeWindow: time as Window,
        ...(note.trim() ? { note: note.trim().slice(0, 500) } : {}),
        whatsappUpdates: consent,
        consentVersion: p.versions.consent,
        noticeVersion: p.versions.notice,
      },
      { idempotencyKey: key.current },
    );
    writeTray([]);
    setRef(res.id);
    setStatus("sent");
    window.scrollTo({ top: 0 });
  }

  function reset() {
    setStatus("idle");
    setIds([]);
    setDay("");
    setOther(false);
    setTime("");
    setNote("");
    setConsent(false);
    setErrors({});
    key.current = null;
  }

  if (status === "sent") {
    const shop = p.shops.find((s) => s.id === branch);
    const dayText = p.days.find((d) => d.iso === day)?.label ?? day;
    return (
      <section className="card sent" aria-live="polite">
        <span className="sent-mark">
          <Check />
        </span>
        <h2 className="display">{t.sentTitle}</h2>
        <p className="sent-line">{t.confirmsOn}</p>
        <dl className="sent-rows">
          <div>
            <dt>{t.stepBranch}</dt>
            <dd>{shop?.name}</dd>
          </div>
          <div>
            <dt>{t.day}</dt>
            <dd>{dayText}</dd>
          </div>
          <div>
            <dt>{t.timeOfDay}</dt>
            <dd>{t[time as Window]}</dd>
          </div>
          <div>
            <dt>{t.yourServices}</dt>
            <dd>{chosen.length ? chosen.map((s) => s.name).join(", ") : p.initial.plan?.name}</dd>
          </div>
        </dl>
        {p.demo || p.sample ? <p className="chip chip-sample">{t.sentDemo}</p> : null}
        <p className="muted sent-ref">{fill(t.sentRef, { id: ref })}</p>
        <div className="sent-actions">
          <a className="btn btn-primary" href={p.links.home}>
            {t.backHome}
          </a>
          <button type="button" className="btn btn-outline" onClick={reset}>
            {t.another}
          </button>
        </div>
      </section>
    );
  }

  const err = (f: Field) => (errors[f] ? { "aria-invalid": true as const, "aria-describedby": `e-${f}` } : {});
  const message = (f: Field) =>
    errors[f] ? (
      <p className="field-error" id={`e-${f}`}>
        {errors[f]}
      </p>
    ) : null;

  return (
    <form className="book" onSubmit={submit} noValidate>
      <p className="form-alert" role="alert" tabIndex={-1} ref={summary} hidden={!Object.keys(errors).length}>
        {t.errSummary}
      </p>

      <section className="card step step-branch" id="f-branch" aria-labelledby="h-branch">
        <h2 className="step-title display" id="h-branch">
          <span className="num">1</span> {t.stepBranch}
        </h2>
        <div className="choices choices-2" role="radiogroup" aria-labelledby="h-branch" {...err("branch")}>
          {p.shops.map((s) => (
            <label key={s.id} className="choice">
              <input type="radio" name="branch" value={s.id} checked={branch === s.id} onChange={() => setBranch(s.id)} />
              <span className="choice-body">
                <strong>{s.name}</strong>
                <span className="muted">{s.area}</span>
              </span>
              <span className="tick" aria-hidden="true">
                <Check />
              </span>
            </label>
          ))}
        </div>
        {message("branch")}
      </section>

      <section className="card step step-when" aria-labelledby="h-when">
        <h2 className="step-title display" id="h-when">
          <span className="num">2</span> {t.stepWhen}
        </h2>
        <fieldset className="field" id="f-day" {...err("day")}>
          <legend>{t.day}</legend>
          <div className="pills">
            {p.days.map((d) => (
              <label key={d.iso} className="pick">
                <input
                  type="radio"
                  name="day"
                  value={d.iso}
                  checked={!other && day === d.iso}
                  onChange={() => {
                    setOther(false);
                    setDay(d.iso);
                  }}
                />
                <span>{d.label}</span>
              </label>
            ))}
            <label className="pick">
              <input
                type="radio"
                name="day"
                value="other"
                checked={other}
                onChange={() => {
                  setOther(true);
                  setDay("");
                }}
              />
              <span>{t.anotherDay}</span>
            </label>
          </div>
          {other ? (
            <label className="date">
              <span>{t.pickDate}</span>
              <input type="date" min={p.minDate} max={p.maxDate} value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
          ) : null}
          {message("day")}
        </fieldset>
        <fieldset className="field" id="f-time" {...err("time")}>
          <legend>{t.timeOfDay}</legend>
          <div className="pills">
            {(["morning", "afternoon", "evening"] as Window[]).map((w) => (
              <label key={w} className="pick">
                <input type="radio" name="time" value={w} checked={time === w} onChange={() => setTime(w)} />
                <span>{t[w]}</span>
              </label>
            ))}
          </div>
          {message("time")}
        </fieldset>
      </section>

      <section className="card step step-services" id="f-services" aria-labelledby="h-services">
        <h2 className="step-title display" id="h-services">
          {t.yourServices}
        </h2>
        {p.initial.plan ? (
          <p className="chip">
            {t.askingAbout}: {p.initial.plan.name}
          </p>
        ) : null}
        {chosen.length ? (
          <ul className="picked">
            {chosen.map((s) => (
              <li key={s.id}>
                <span>
                  <strong>{s.name}</strong>
                  <span className="muted">
                    {duration(s.minutes, p.lang)} · {s.from ? fill(t.from, { price: money(s.minor) }) : money(s.minor)}
                  </span>
                </span>
                <button type="button" className="tray-remove" aria-label={fill(t.remove, { name: s.name })} onClick={() => removeService(s.id)}>
                  <Cross />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t.noServices}</p>
        )}
        {chosen.length ? (
          <p className="picked-total">
            <span>{duration(minutes, p.lang)}</span>
            <strong>{chosen.some((s) => s.from) ? fill(t.from, { price: total }) : total}</strong>
          </p>
        ) : null}
        {p.sample && chosen.length ? <span className="chip chip-sample">{t.samplePrices}</span> : null}
        <a className="text-link" href={p.links.services}>
          {chosen.length ? t.changeServices : t.chooseServices}
          <Chevron />
        </a>
        {message("services")}
      </section>

      <section className="card step step-you" aria-labelledby="h-you">
        <h2 className="step-title display" id="h-you">
          <span className="num">3</span> {t.stepYou}
        </h2>
        <label className="input" id="f-name">
          <span>{t.yourName}</span>
          <input name="name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} {...err("name")} />
          {message("name")}
        </label>
        <label className="input" id="f-phone">
          <span>{t.phone}</span>
          <span className="phone">
            <span className="prefix">+91</span>
            <input
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              {...err("phone")}
            />
          </span>
          {errors.phone ? null : <span className="muted hint">{t.phoneHint}</span>}
          {message("phone")}
        </label>
        <label className="input">
          <span>{t.note}</span>
          <textarea name="note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" name="whatsappUpdates" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span className="box" aria-hidden="true">
            <Check />
          </span>
          <span>
            {t.consent}
            <span className="muted hint">{t.consentHint}</span>
          </span>
        </label>
        <div className="visually-hidden" aria-hidden="true">
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <p className="fine">
          {t.privacyLine}{" "}
          <a href={p.links.privacy} className="inline-link">
            {t.privacy}
          </a>
        </p>
        {/* Until the form posts to the API (MS-29), nothing leaves the page, live build or not: say so. */}
        {p.demo || p.sample ? <p className="chip chip-sample demo-line">{t.demoForm}</p> : null}
        <button className="btn btn-primary btn-block" type="submit" disabled={status === "sending"}>
          {status === "sending" ? t.sending : t.send}
        </button>
        <p className="confirm-note">{t.confirmsOn}</p>
      </section>
    </form>
  );
}
