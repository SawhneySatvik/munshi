"use client";

import { useRef, useState } from "react";
import { AUTH_WORDS } from "../../app/(auth)/words";
import { makeSampleShop } from "../../app/demo/actions";
import { useLang } from "../LangProvider";
import { ONBOARD_WORDS } from "./onboard-words";

export type Notice = "taken" | "invalid" | "limit";
const TYPES = ["kirana", "salon", "apparel"] as const;

/** A web address suggested from the shop's name: lower-case Latin letters, digits and hyphens, starting with a letter. */
export function suggestSlug(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return s.length >= 3 ? s : "";
}

/**
 * The onboarding screens for a visitor's own sample shop: what kind of shop, its name, then in. One form
 * that posts to the real makeSampleShop action; the steps only show one part of it at a time. `back` names where a
 * refusal returns (this page), and the refusal's line shows on the name step.
 */
export function Onboarding({ back, notice }: { back: "demo" | "sign-up"; notice?: Notice | undefined }) {
  const { lang } = useLang();
  const a = AUTH_WORDS[lang];
  const w = ONBOARD_WORDS[lang];
  const [step, setStep] = useState(notice ? 1 : 0);
  const [type, setType] = useState<(typeof TYPES)[number]>("kirana");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [owner, setOwner] = useState("");
  const nameStep = useRef<HTMLFieldSetElement>(null);
  const typeLabel = { kirana: a.kirana, salon: a.salon, apparel: a.apparel };
  const typeBody = { kirana: w.kiranaBody, salon: w.salonBody, apparel: w.apparelBody };
  const line = notice === "taken" ? a.sampleTaken : notice === "invalid" ? a.sampleInvalid : notice === "limit" ? a.sampleLimit : null;

  const toThird = () => {
    const inputs = [...(nameStep.current?.querySelectorAll("input") ?? [])];
    if (inputs.every((i) => i.reportValidity())) setStep(2);
  };

  return (
    <form action={makeSampleShop} className="s-onboard" aria-labelledby="onboard-h">
      <input type="hidden" name="back" value={back} />
      <ol className="s-progress" aria-label={w.progress}>
        {[w.stepType, w.stepName, w.stepIn].map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined} className={i < step ? "is-done" : undefined}>
            {label}
          </li>
        ))}
      </ol>
      {line ? (
        <p className="s-alert" role="alert">
          {line}
        </p>
      ) : null}

      <fieldset className="s-step" hidden={step !== 0}>
        <legend className="s-step-h" id={step === 0 ? "onboard-h" : undefined}>
          {w.typeTitle}
        </legend>
        <div className="s-types">
          {TYPES.map((t) => (
            <label key={t} className="s-type">
              <input type="radio" name="businessType" value={t} checked={type === t} onChange={() => setType(t)} />
              <span className="s-type-n">{typeLabel[t]}</span>
              <span className="s-type-b">{typeBody[t]}</span>
            </label>
          ))}
        </div>
        <div className="s-step-acts">
          <button type="button" className="s-btn is-lg" onClick={() => setStep(1)}>
            {w.next}
          </button>
        </div>
      </fieldset>

      {/* Enter in a field moves to the last step, as Next does, rather than submitting past it. */}
      <fieldset
        className="s-step"
        hidden={step !== 1}
        ref={nameStep}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            toThird();
          }
        }}
      >
        <legend className="s-step-h" id={step === 1 ? "onboard-h" : undefined}>
          {w.nameTitle}
        </legend>
        <label className="s-field">
          <span className="s-field-l">{a.shopName}</span>
          <input
            className="s-input"
            name="name"
            type="text"
            autoComplete="organization"
            required
            maxLength={120}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(suggestSlug(e.target.value));
            }}
          />
        </label>
        <label className="s-field">
          <span className="s-field-l">{a.webAddress}</span>
          <input
              className="s-input"
              name="slug"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              pattern="[a-z][a-z0-9\-]{2,39}"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              aria-describedby="slug-n"
            />
          <span className="s-field-n" id="slug-n">
            {w.slugNote}
          </span>
        </label>
        <label className="s-field">
          <span className="s-field-l">{a.yourName}</span>
          <input className="s-input" name="ownerName" type="text" autoComplete="name" required value={owner} onChange={(e) => setOwner(e.target.value)} />
        </label>
        <div className="s-step-acts">
          <button type="button" className="s-ghost is-lg" onClick={() => setStep(0)}>
            {w.back}
          </button>
          <button type="button" className="s-btn is-lg" onClick={toThird}>
            {w.next}
          </button>
        </div>
      </fieldset>

      <fieldset className="s-step" hidden={step !== 2}>
        <legend className="s-step-h" id={step === 2 ? "onboard-h" : undefined}>
          {w.inTitle}
        </legend>
        <dl className="s-summary">
          <div>
            <dt>{a.businessType}</dt>
            <dd>{typeLabel[type]}</dd>
          </div>
          <div>
            <dt>{a.shopName}</dt>
            <dd data-name="">{name}</dd>
          </div>
          <div>
            <dt>{a.webAddress}</dt>
            <dd data-name="">{slug}</dd>
          </div>
          <div>
            <dt>{a.yourName}</dt>
            <dd data-name="">{owner}</dd>
          </div>
        </dl>
        <p className="s-step-n">{a.sampleLede}</p>
        <div className="s-step-acts">
          <button type="button" className="s-ghost is-lg" onClick={() => setStep(1)}>
            {w.back}
          </button>
          <button type="submit" className="s-btn is-lg">
            {a.makeSample}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
