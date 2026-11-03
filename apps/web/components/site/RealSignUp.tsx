import { finishRealSignUp, signUpReal, startRealSignUp } from "../../app/(site)/sign-up/actions";
import type { AuthWords } from "../../app/(auth)/words";
import type { OnboardingWords } from "../../lib/i18n-onboard";

const TYPES = ["kirana", "salon", "apparel"] as const;

function Input({ label, note, ...input }: { label: string; note?: string; name: string; type: string; autoComplete: string; pattern?: string; maxLength?: number }) {
  return (
    <label className="s-field">
      <span className="s-field-l">{label}</span>
      <input className="s-input" required {...input} />
      {note ? <span className="s-field-n">{note}</span> : null}
    </label>
  );
}

/**
 * A real shop's sign-up form (D-079, D-080), server-rendered, posting to a server action. With an email service
 * (`emailLink`) it takes no password: the action emails a link and the password is set on the link's page, so the
 * identity is made with the verified email. Without one it takes the password here and says plainly that the email is
 * not verified on this deployment.
 */
export function RealSignUpForm({ a, w, emailLink }: { a: AuthWords; w: OnboardingWords; emailLink: boolean }) {
  const typeLabel = { kirana: a.kirana, salon: a.salon, apparel: a.apparel };
  return (
    <form action={emailLink ? startRealSignUp : signUpReal} className="s-form" aria-labelledby="real-h">
      <p className="s-field-n">{emailLink ? w.emailLede : w.unverified}</p>
      <Input label={a.shopName} name="shopName" type="text" autoComplete="organization" maxLength={80} />
      <fieldset className="s-field">
        <legend className="s-field-l">{w.kind}</legend>
        <div className="s-types">
          {TYPES.map((t, i) => (
            <label key={t} className="s-type">
              <input type="radio" name="businessType" value={t} defaultChecked={i === 0} />
              <span className="s-type-n">{typeLabel[t]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Input label={w.city} name="city" type="text" autoComplete="address-level2" maxLength={80} />
      <Input label={a.webAddress} note={w.slugNote} name="slug" type="text" autoComplete="off" pattern="[a-z][a-z0-9\-]{2,39}" />
      <Input label={a.yourName} name="ownerName" type="text" autoComplete="name" maxLength={80} />
      <Input label={a.email} name="email" type="email" autoComplete="email" />
      {emailLink ? null : <Input label={a.password} note={a.rules} name="password" type="password" autoComplete="new-password" />}
      <button type="submit" className="s-btn is-lg">
        {emailLink ? w.sendLink : w.submitReal}
      </button>
    </form>
  );
}

/** The email link's page: the password, and the link's token hash, which the action spends (never the page's GET). */
export function ConfirmForm({ a, w, tokenHash }: { a: AuthWords; w: OnboardingWords; tokenHash: string }) {
  return (
    <form action={finishRealSignUp} className="s-form">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <Input label={a.password} note={a.rules} name="password" type="password" autoComplete="new-password" />
      <button type="submit" className="s-btn is-lg">
        {w.setPassword}
      </button>
    </form>
  );
}
