// Red-proofs of M6's gates: the queued fixes (the purge spares operators and queues what it frees, verified_via 'self',
// the console's city, test recipients a real shop's, orders the office's, Instagram's inbound, card and stuck delivery),
// the router per shop (models and features), the data version and the push subscriptions, and the why-walk's index.
import type { Case } from './case.ts';
import { asOwner, dropCheck, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const at = (file: string) => (test: string, sabotage: string, sql: string): Case => ({ sabotage, file, test, config: V2, sql });
const pend = at('test/v2/gates/03-pending.test.ts');
const msg = at('test/v2/gates/19-messaging.test.ts');
const ord = at('test/v2/gates/21-orders.test.ts');
const router = at('test/v2/gates/22-shop-router.test.ts');
const ver = at('test/v2/gates/26-version-push.test.ts');
const man = at('test/v2/gates/manifest.test.ts');

const PURGE = 'ops.purge_pending_signups()';
const GRANT = 'platform.grant_class()';
const QUEUE = 'ops.identity_erase_guard()';
const IDENTITY = 'idp.identity_guard()';
const RECIPIENT = 'ops.recipient_guard()';
const INBOUND = 'ops.inbound_flow()';
const DELIVERY = 'ops.delivery_status()';
const CHOICE = 'ops.model_choice_guard()';
const MODELS = 'ai.shop_models()';
const BUMP = 'ops.version_bump()';
const VGUARD = 'ops.version_guard()';
const PUSH = 'ops.push_guard()';

const PURGE_OP = 'PURGE-OP the purge never returns or queues an operator’s identity: its lapsed shop is purged, the identity is left whole';
const ERASEQ1 =
  'ERASEQ1 the purge queues each password identity it frees; only the purge queues, never a held one; the identity adapter takes a row off only once its identity is erased or held';
const IDP3 = 'IDP3 a self-asserted email (verified_via self) is refused on a hosted or live deployment, and taken on a local or test one';
const R1 =
  'R1 an active owner lists test recipients only under a live WhatsApp grant and within its cap, each with its route in one transaction; a number routes to one shop (first come); routes are erased with their removed recipient';
const OFFICE = 'ORD-OFFICE orders are the office’s: staff neither confirm, step nor reschedule an order (MS001), an owner or a manager does; staff keep the counter’s sale, package redemption and payment';
const IG1 = 'IG1 the bare-STOP rule is WhatsApp’s: on Instagram a STOP is a message like any other';
const IG2 =
  'IG2 an Instagram message, from the sender’s Instagram-scoped id, reaches only a real shop whose latest Instagram grant grants it for the account it was sent to; the webhook finds the shop by the grant’s account';
const IGROUTE = 'IG-ROUTE1 an Instagram account routes to one shop: a granted Instagram grant names its account, and an account another live shop holds granted is refused at approval; once that shop withdraws, it may be granted';
const IG3 = 'IG3 a post’s card is public once its Instagram campaign is approved or sent, never while composing or for a WhatsApp campaign; the sender reads which card a campaign names';
const STUCK1 =
  'STUCK1 a delivery sending for more than a day takes a final_at from the jobs role, its status unchanged, so the address purge reaches it; never sooner, by another role, or with another change';
const ROUTER1 =
  'ROUTER1 a shop uses no model off its list: its list narrows the deployment’s, a role with no list takes the deployment’s, its default reads back, and an owner’s pick off the list is refused';
const ROUTER2 =
  'ROUTER2 a feature the operator turned off is refused where a write exists: its run, the brief’s narrated line, a memory note; a brief run and another shop are untouched';
const ROUTER3 =
  'ROUTER3 both lists change only through an approved change of their kind for exactly that row, audited and chained; the app and the jobs role read only their own shop’s';
const VER1 =
  'VER1 a write in any covered table bumps its shop’s version once per transaction, a platform change for the shop too; a read bumps nothing; another shop’s stays';
const VER2 = 'VER2 the counter is written only by its triggers, only upward by one; the app and the jobs role read it, the agent does not';
const VER3 = 'VER3 every table holding a shop’s book or ops state carries the deferred bump; the exclusions are exactly 26’s list';
const PUSH1 =
  'PUSH1 a member adds and revokes only their own subscription, from a real session; the app never reads the sealed blobs; the sender reads them and revokes; nothing else changes';
const PUSH3 =
  'PUSH3 one device is one live subscription in a shop: a newer one for the same endpoint, another member’s or the same member’s, revokes the older in its own insert';
const PUSH2 = 'PUSH2 a member’s deactivation revokes, and their erasure erases, their subscriptions in the same update; never otherwise';
const MEM12 = 'MEM12 a note naming many parties keeps every one: twelve are accepted (up to 32), and erasing any one of them blanks its words';
const APP4_STAFF = "ORD-OFFICE-WEB counter staff confirm and step no order: each action answers refused and writes nothing";
const G10 = 'G10 every declared index exists in pg_index exactly as declared, and no undeclared index exists';
const ON4_RETRY = 'ON4-RETRY an erase that fails after the purge committed stays queued, and the next run erases it';
const ON2 = 'ON2 the console lists the shop waiting; accept is proposed, approved in a later request, audited, and opens /app with Getting started';

export const M6_CASES: Case[] = [
  // A1, A3: the purge spares operators and queues what it frees; only the purge queues; the adapter's delete waits.
  pend(PURGE_OP, 'v2-m6-purge-operator', `${mutate(PURGE, '\n         and not exists (select 1 from ops.subject_summary x where x.provider = freed.p and x.subject = freed.s and x.is_operator)', '')}
    ${mutate(QUEUE, ' or x.is_operator', '')}`),
  pend(ERASEQ1, 'v2-m6-queue-insert', mutate(PURGE, 'insert into ops.identity_erase (provider, subject) values (freed.p, freed.s) on conflict do nothing;', 'null;')),
  pend(ERASEQ1, 'v2-m6-queue-held', mutate(QUEUE, '(x.memberships > 0 or x.is_operator)', 'x.is_operator')),
  pend(ERASEQ1, 'v2-m6-queue-actor', mutate(QUEUE, " or nullif(current_setting('munshi.actor_id', true), '') is not null", '')),
  pend(ERASEQ1, 'v2-m6-queue-delete-policy', 'drop policy erase_done on ops.identity_erase;'),
  pend(ERASEQ1, 'v2-m6-queue-held-again', `alter policy erase_done on ops.identity_erase
     using (not exists (select 1 from idp.identity i where i.subject::text = identity_erase.subject and i.erased_at is null));`),
  pend(ERASEQ1, 'v2-m6-queue-uuid', dropCheck('ops.identity_erase', '{12}')),
  {
    sabotage: 'v2-m6-retry-queue',
    file: 'test/v2/core/jobs/signups.test.ts',
    test: ON4_RETRY,
    config: V2,
    sql: mutate(PURGE, 'insert into ops.identity_erase (provider, subject) values (freed.p, freed.s) on conflict do nothing;', 'null;'),
  },
  // A2: 'self' only off a served deployment.
  pend(IDP3, 'v2-m6-self-served', mutate(IDENTITY, "elsif new.verified_via = 'self' and coalesce(", "elsif false and coalesce(")),
  // A4: the console's city.
  {
    sabotage: 'v2-m6-console-city',
    dir: 'apps/web',
    config: 'vitest.config.ts',
    file: 'test/onboarding.test.tsx',
    test: ON2,
    ts: { file: 'apps/web/components/platform/Signups.tsx', from: 's.businessType, s.city, s.slug', to: 's.businessType, s.slug' },
  },
  // A5: test recipients are a real shop's.
  msg(R1, 'v2-m6-recipient-class', mutate(RECIPIENT, "and t.data_class = 'live') then", ') then')),
  // A6: orders are the office's.
  ord(OFFICE, 'v2-m6-staff-confirms', "insert into ref.command_authority (command, role) values ('order.confirm', 'staff');"),
  ord(OFFICE, 'v2-m6-staff-steps', "insert into ref.command_authority (command, role) values ('order.step', 'staff');"),
  ord(OFFICE, 'v2-m6-staff-reschedules', "insert into ref.command_authority (command, role) values ('order.reschedule', 'staff');"),
  // A7: Instagram's inbound, its card, and a stuck delivery.
  msg(IG1, 'v2-m6-stop-any-channel', mutate(INBOUND, "(new.channel = 'whatsapp' and upper(btrim(coalesce(new.text, ''))) = 'STOP')", "upper(btrim(coalesce(new.text, ''))) = 'STOP'")),
  msg(IG2, 'v2-m6-ig-ungranted', mutate(INBOUND, "if new.channel = 'instagram' and not coalesce(", "if false and not coalesce(")),
  msg(IG2, 'v2-m6-ig-account-match', mutate(INBOUND, 'select g.granted and g.account_ref = new.account_ref from', 'select g.granted from')),
  msg(IG2, 'v2-m6-ig-public-whatsapp', 'drop policy instagram_public on platform.channel_grant;'),
  pend(IGROUTE, 'v2-m6-ig-route-taken', mutate(GRANT, "\n    if exists (select 1 from platform.channel_grant g\n                where g.channel = 'instagram' and g.account_ref = new.account_ref and g.granted and g.tenant_id <> new.tenant_id", "\n    if false and exists (select 1 from platform.channel_grant g\n                where g.channel = 'instagram' and g.account_ref = new.account_ref and g.granted and g.tenant_id <> new.tenant_id")),
  pend(IGROUTE, 'v2-m6-ig-route-unnamed', mutate(GRANT, "    if new.account_ref is null then", "    if false then")),
  msg(
    IG3,
    'v2-m6-ig-card-status',
    // Held twice (the document policy's status and the campaign's own public policy): broken in both, as one protection.
    `drop policy campaign_public on ops.campaign;
     alter policy document_public on ops.document using (kind in ('card', 'art') and erased_at is null and (
       exists (select 1 from ops.site_release r join ops.site_look l on l.tenant_id = r.tenant_id and l.id = r.look_id
                where r.tenant_id = document.tenant_id and exists (select 1 from jsonb_each_text(l.art) a where a.value = document.id::text))
       or (kind = 'card' and exists (select 1 from ops.campaign c where c.tenant_id = document.tenant_id and c.card_document_id = document.id
                                        and c.channel = 'instagram'))));`,
  ),
  msg(IG3, 'v2-m6-ig-campaign-public', 'drop policy campaign_public on ops.campaign;'),
  msg(IG3, 'v2-m6-ig-card-jobs', 'revoke select (card_document_id) on ops.campaign from munshi_jobs;'),
  msg(STUCK1, 'v2-m6-stuck-age', mutate(DELIVERY, " or old.claimed_at >= now() - interval '1 day'", '')),
  msg(STUCK1, 'v2-m6-stuck-only-final', mutate(DELIVERY, "\n       or to_jsonb(new) - array['final_at', 'updated_at'] <> to_jsonb(old) - array['final_at', 'updated_at']", '')),
  // B: the router per shop.
  router(ROUTER1, 'v2-m6-choice-shop-list', mutate(CHOICE, "\n          and (not exists (select 1 from platform.shop_model sm where sm.tenant_id = new.tenant_id and sm.role = a.role)\n               or (select sm.allowed from platform.shop_model sm\n                    where sm.tenant_id = new.tenant_id and sm.alias = new.alias and sm.role = a.role\n                    order by sm.effective_from desc, sm.id desc limit 1) is true)", '')),
  router(ROUTER1, 'v2-m6-models-shop-list', mutate(MODELS, 'and (l.role is null or exists (select 1 from shop x where x.alias = d.alias and x.role = d.role and x.allowed))', '')),
  router(ROUTER1, 'v2-m6-models-deployment-bound', mutate(MODELS, '     where d.enabled\n', '     where true\n')),
  router(ROUTER2, 'v2-m6-feature-run', 'drop trigger feature on ai.run;'),
  router(ROUTER2, 'v2-m6-feature-answer', 'drop trigger feature on ai.answer;'),
  router(ROUTER2, 'v2-m6-feature-memory', 'drop trigger feature on ai.memory;'),
  router(ROUTER3, 'v2-m6-feature-guard', 'drop trigger guard on platform.shop_feature;'),
  router(ROUTER3, 'v2-m6-model-guard', 'drop trigger guard on platform.shop_model;'),
  router(ROUTER3, 'v2-m6-feature-audit', 'drop trigger audit on platform.shop_feature;'),
  router(ROUTER3, 'v2-m6-feature-own-shop', 'drop policy own_shop on platform.shop_feature;'),
  router(ROUTER3, 'v2-m6-model-own-shop', 'drop policy own_shop on platform.shop_model;'),
  {
    sabotage: 'v2-m6-ms021-unmapped',
    file: 'test/v2/gates/22-shop-router.test.ts',
    test: ROUTER2,
    config: V2,
    ts: { file: 'packages/core/src/errors.ts', from: "  MS021: 'feature_off',", to: "  MS099: 'feature_off'," },
  },
  router(ROUTER3, 'v2-m6-feature-app-insert', 'grant insert on platform.shop_feature to munshi_app;'),
  // C: the data version.
  ver(VER1, 'v2-m6-version-once', mutate(VGUARD, 'if old.bumped_txid is not distinct from txid_current() then\n    return null;', 'if false then\n    return null;')),
  ver(VER1, 'v2-m6-version-plus-one', mutate(VGUARD, 'new.version := old.version + 1;', 'new.version := old.version + 2;')),
  ver(VER1, 'v2-m6-bump-context', mutate(BUMP, "  perform set_config('munshi.tenant_id', t::text, true);\n", '')),
  ver(VER1, 'v2-m6-bump-books', 'drop trigger z_version on books.customer;'),
  ver(VER1, 'v2-m6-bump-platform', 'drop trigger z_version on platform.shop_feature;'),
  ver(VER1, 'v2-m6-bump-ask-words', `create constraint trigger z_version after insert or update or delete on ops.message_text deferrable initially deferred
    for each row execute function ops.version_bump();`),
  ver(VER1, 'v2-m6-bump-snapshot', `create constraint trigger z_version after insert or update or delete on snap.snapshot deferrable initially deferred
    for each row execute function ops.version_bump();`),
  ver(VER2, 'v2-m6-version-depth', mutate(VGUARD, 'if pg_trigger_depth() < 2 then', 'if false then')),
  ver(VER2, 'v2-m6-version-agent', 'grant usage on schema ops to munshi_agent; grant select on ops.tenant_version to munshi_agent;'),
  ver(VER3, 'v2-m6-cover-contact', 'drop trigger z_version on ops.contact;'),
  ver(VER3, 'v2-m6-cover-immediate', `drop trigger z_version on ops.contact;
    create trigger z_version after insert or update or delete on ops.contact for each row execute function ops.version_bump();`),
  ver(PUSH1, 'v2-m6-push-own', mutate(PUSH, " or new.member_id is distinct from ctx_actor\n", '\n')),
  ver(PUSH1, 'v2-m6-push-revoke-own', mutate(PUSH, "(current_user = 'munshi_app' and ctx_actor = old.member_id)", "current_user = 'munshi_app'")),
  ver(PUSH1, 'v2-m6-push-blobs', 'grant select (endpoint_enc) on ops.push_subscription to munshi_app;'),
  ver(PUSH1, 'v2-m6-push-real-session', mutate(PUSH, "if nullif(current_setting('munshi.via', true), '') is distinct from 'real' then", 'if false then')),
  ver(PUSH3, 'v2-m6-push-device-replace', mutate(PUSH, '    update ops.push_subscription p set revoked_at = now()\n     where p.tenant_id = new.tenant_id and p.endpoint_hash = new.endpoint_hash and p.revoked_at is null;\n', '')),
  man(G10, 'v2-m6-push-live-index', asOwner('drop index ops.push_live;')),
  ver(PUSH2, 'v2-m6-push-member', 'drop trigger push on ops.member;'),
  ver(PUSH2, 'v2-m6-push-erase-member', mutate(PUSH, '\n     and not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = new.member_id and m.erased_at is not null)', '')),
  // E: a note's parties, up to 32.
  {
    sabotage: 'v2-m6-about-eight',
    file: 'test/v2/gates/23-memory.test.ts',
    test: MEM12,
    config: V2,
    sql: `${dropCheck('ai.memory', 'jsonb_array_length(about) <= 32')} alter table ai.memory add check (jsonb_array_length(about) <= 8);`,
  },
  // A6 on the screen: counter staff's confirm and step are refused, and the action says so (refused, not other).
  {
    sabotage: 'v2-m6-app4-staff-code',
    dir: 'apps/web',
    config: 'vitest.config.ts',
    file: 'test/app4.test.tsx',
    test: APP4_STAFF,
    ts: { file: 'apps/web/lib/server/ops.ts', from: 'if (err.code === "refused" || err.code === "not_for_role") return "refused";', to: 'if (err.code === "not_for_role") return "refused";' },
  },
  // D: the why-walk's index.
  man(G10, 'v2-m6-book-id-index', 'drop index audit.audit_book_id;'),
];
