import type { PlatformRowRef } from "@munshi/core";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHead } from "../PageHead";
import { Sticker } from "../Sticker";
import "../CannotVerify.css";
import "../shell/TopBar.css";
import "./Console.css";

// The superadmin console's frame and its pieces, in Neem Ledger's tokens. English only: an operator's
// tool. A config value is shown beside the id of the approved platform.change that wrote it; a value no change
// wrote is labelled "Cannot verify" with why.

const NAV = [
  ["/platform", "Shops"],
  ["/platform/defaults", "Demo defaults and slugs"],
  ["/platform/changes", "Changes"],
  ["/platform/models", "Models"],
  ["/platform/operators", "Operators"],
] as const;
// Out of the console, to the site it shares. The links go one way only: no page of the site links here.
const OUT = [
  ["/", "Munshi home"],
  ["/app", "The app"],
] as const;

/** The console's header: the mark, "Platform console", and that it is for operators only; the nav once signed in. */
export function ConsoleFrame({ signedIn, signOut, children }: { signedIn: boolean; signOut?: () => Promise<void>; children: ReactNode }) {
  return (
    <div className="pc">
      <header className="bar">
        <div className="wrap bar-in">
          <span className="bar-id">
            <span className="bar-mark" aria-hidden="true">
              M
            </span>
            <span className="word">Munshi · Platform console</span>
          </span>
          <div className="bar-r">
            <Sticker tone="yellow">Operators only</Sticker>
          </div>
        </div>
      </header>
      {signedIn ? (
        <nav className="pc-nav" aria-label="Console">
          <div className="wrap pc-nav-in">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className="pc-nav-a">
                {label}
              </Link>
            ))}
            {OUT.map(([href, label]) => (
              <Link key={href} href={href} className="pc-nav-a" data-out="site">
                {label}
              </Link>
            ))}
            {signOut ? (
              <form action={signOut} className="pc-nav-out">
                <button type="submit" className="pc-link">
                  Sign out
                </button>
              </form>
            ) : null}
          </div>
        </nav>
      ) : null}
      <main className="wrap pc-main">{children}</main>
      <footer className="wrap pc-foot">
        Every setting here changes only as a proposal that a later request approves; nothing applies on its own. The shops
        on a demo deployment hold synthetic data.
      </footer>
    </div>
  );
}

/** A console page's head: the app's one-line head (its name, where it is beside it, one muted line under it). */
export function ConsoleHead({ id, kicker, title, lede }: { id: string; kicker: string; title: string; lede: ReactNode }) {
  return <PageHead id={id} kicker={kicker} title={title} lede={lede} />;
}

/** One line of the result of the last action: a success in neem, a refusal in the warn colours. */
export function Notice({ tone, children }: { tone: "ok" | "warn"; children: ReactNode }) {
  return (
    <p className={`pc-notice is-${tone}`} role={tone === "warn" ? "alert" : "status"}>
      {children}
    </p>
  );
}

/** verifyPlatformChain's result: the chain verifies, or the first seq at which it breaks. */
export function ChainLine({ brokenAt }: { brokenAt: string | null }) {
  return brokenAt === null ? (
    <Notice tone="ok">The platform chain verifies: every proposal, decision and write is in it, unaltered.</Notice>
  ) : (
    <Notice tone="warn">The platform chain does not verify: it breaks at entry {brokenAt}. Stop and investigate before approving anything.</Notice>
  );
}

export const changeHref =(id: string) => `/platform/changes/${id}`;

/** Where a value came from: the approved change that wrote its row, or "Cannot verify" when no change wrote one. */
export function SetBy({ from, none }: { from: Pick<PlatformRowRef, "changeId"> | null; none: string }) {
  if (!from?.changeId) {
    return (
      <span className="pc-ref is-none">
        <span className="cv-tag">Cannot verify</span> <span>{none}</span>
      </span>
    );
  }
  return (
    <span className="pc-ref">
      set by change{" "}
      <Link href={changeHref(from.changeId)} className="pc-id">
        {from.changeId}
      </Link>
    </span>
  );
}

export const onOff = (v: boolean) => (v ? "On" : "Off");
export const yesNo = (v: boolean) => (v ? "Yes" : "No");
/** A Postgres timestamp's date and minute, as the server read it (UTC on the console). */
export const when = (ts: string) => ts.slice(0, 16);

export const KIND_LABEL: Record<string, string> = {
  shop_config: "AI and caps",
  site_verify: "Site verification",
  channel_grant: "Channel grant",
  default_config: "Demo default config",
  reserved_slug: "Reserved slug",
  operator: "Operator",
  tenant_accept: "Shop acceptance",
  shop_models: "Shop models",
  shop_features: "Shop AI feature",
  ai_budget: "Monthly AI budget",
};

/** A labelled control of a proposal form. */
export function Control({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the children, inside the label.
    <label className="pc-field">
      <span className="pc-field-l">{label}</span>
      {children}
      {hint ? <span className="pc-hint">{hint}</span> : null}
    </label>
  );
}

export function OnOffSelect({ name, value }: { name: string; value: boolean }) {
  return (
    <select name={name} defaultValue={value ? "true" : "false"} className="pc-input">
      <option value="true">On</option>
      <option value="false">Off</option>
    </select>
  );
}

export function NumberInput({ name, value, max }: { name: string; value: number; max: number }) {
  return <input name={name} type="number" min={0} max={max} step={1} defaultValue={value} required className="pc-input" inputMode="numeric" />;
}
