// The AI features the operator can switch per shop (D-079 §8, 22_ai_controls.sql's platform.shop_feature): a feature is
// usable only while the shop has AI at all (platformLimits, as allow() reads it) AND its own switch is on
// (ai.shop_features(): no row is on). The database refuses a switched-off feature's write (MS021: its run, the brief's
// narrated line, a memory note); core checks first, so a surface hides or labels it, and the brief and an approval go on
// without it instead of failing. In the caller's transaction, under the shop's context.
import type pg from 'pg';
import type { DeploymentAi } from './allow.ts';
import { CoreError } from './errors.ts';
import { platformLimits, SHOP_FEATURES } from './platform.ts';

export const AI_FEATURES = SHOP_FEATURES;
export type AiFeature = (typeof AI_FEATURES)[number];

/** The feature an AI run of each trigger is (ai.feature_gate's own map); a brief, watcher or recipe run is none. */
export const TRIGGER_FEATURE: Readonly<Partial<Record<string, AiFeature>>> = {
  question: 'ask',
  photo: 'photos',
  voice: 'voice',
  speak: 'read_aloud',
  campaign: 'campaign_copy',
  inbox: 'inbox_drafts',
};

/**
 * One feature's state: `on` is whether it may be offered now; `why` names the first reason it may not (the shop has no
 * AI, or the operator switched it off); `changeId` is the approved change behind its switch (null: never switched).
 */
export type FeatureState = { on: boolean; switched: boolean; why: 'ai_off' | 'switched_off' | null; changeId: string | null };

/** Each feature's own switch (ai.shop_features()): true with no row. */
export async function featureSwitches(c: pg.ClientBase): Promise<Record<AiFeature, { on: boolean; changeId: string | null }>> {
  const { rows } = await c.query<{ feature: AiFeature; enabled: boolean; change_id: string | null }>('select feature, enabled, change_id::text from ai.shop_features()');
  const out = Object.fromEntries(AI_FEATURES.map((f) => [f, { on: true, changeId: null }])) as Record<AiFeature, { on: boolean; changeId: string | null }>;
  for (const r of rows) if ((AI_FEATURES as readonly string[]).includes(r.feature)) out[r.feature] = { on: r.enabled, changeId: r.change_id };
  return out;
}

/** Whether one feature's switch is on (not whether AI is): what a write the database gates by the switch checks. */
export async function featureOn(c: pg.ClientBase, feature: AiFeature): Promise<boolean> {
  return (await featureSwitches(c))[feature].on;
}

/** Refuses with feature_off, before any write, a feature whose switch is off. */
export async function refuseFeatureOff(c: pg.ClientBase, feature: AiFeature): Promise<void> {
  if (!(await featureOn(c, feature))) throw new CoreError('feature_off', { fields: [feature] });
}

/** Every feature's state for a screen: AI on for the shop (as allow() reads it) AND its switch. */
export async function aiFeatures(c: pg.ClientBase, tenantId: string, deploymentAi: DeploymentAi): Promise<Record<AiFeature, FeatureState>> {
  const limits = await platformLimits(c, tenantId);
  const ai = deploymentAi === 'on' && limits.aiEnabled && !(limits.sandbox && !limits.sandboxAiEnabled);
  const switches = await featureSwitches(c);
  return Object.fromEntries(
    AI_FEATURES.map((f) => {
      const s = switches[f];
      return [f, { on: ai && s.on, switched: s.on, why: !s.on ? 'switched_off' : ai ? null : 'ai_off', changeId: s.changeId }];
    }),
  ) as Record<AiFeature, FeatureState>;
}
