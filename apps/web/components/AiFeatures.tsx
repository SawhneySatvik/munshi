"use client";

// The shop's AI features as the operator set them, read once by the app's layout and handed to every surface:
// a feature the operator switched off for the shop is hidden or labelled "Switched off for this shop", and its action
// would be refused (feature_off) anyway. With no provider above it (a page outside the app's shell, a test), every
// feature reads as on, as before the router. AI off for the whole shop is not this switch: those surfaces still show and
// fall back to their templates, as before.
import { createContext, type ReactNode, useContext } from "react";
import { ROUTER } from "../lib/i18n-router";
import { useLang } from "./LangProvider";

export type AiFeatureName = "ask" | "photos" | "voice" | "read_aloud" | "narration" | "campaign_copy" | "inbox_drafts" | "memory";
/** The features the operator switched off for the shop (nothing else: no figure, no reason text). */
export type SwitchedOffFeatures = readonly AiFeatureName[];

const Ctx = createContext<SwitchedOffFeatures>([]);

export function AiFeaturesProvider({ off, children }: { off: SwitchedOffFeatures; children: ReactNode }) {
  return <Ctx.Provider value={off}>{children}</Ctx.Provider>;
}

/** Whether the operator left this feature on for the shop. */
export function useFeatureOn(feature: AiFeatureName): boolean {
  return !useContext(Ctx).includes(feature);
}

/** A feature's control, or the line saying it is switched off for the shop. */
export function FeatureGate({ feature, children }: { feature: AiFeatureName; children: ReactNode }) {
  return useFeatureOn(feature) ? children : <SwitchedOff feature={feature} />;
}

/** The line a surface shows in place of a feature switched off. */
export function SwitchedOff({ feature, className = "l-sub" }: { feature: AiFeatureName; className?: string }) {
  const { lang } = useLang();
  return (
    <p className={className} data-switched-off={feature}>
      {ROUTER[lang].switchedOff}
    </p>
  );
}
