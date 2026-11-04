"use client";

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { useLang } from "../LangProvider";
import { Art } from "./Art";
import { FEATURE_SAMPLE, type FeatureSample, SHELF_MODELS } from "./features-example";
import { type FeatureWords, FEATURE_WORDS } from "./features-words";
import { Mark, Ring, Wave } from "./Mark";
import { Ctas } from "./SiteHome";
import { type SiteWords, SITE_WORDS } from "./words";
import "./features.css";

type Says = { f: FeatureWords; s: FeatureSample; w: SiteWords; hindi: boolean };

/** An element's start within its demonstration's sequence. */
const at = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

const half = "(min-width: 1000px) 640px, 100vw";

/**
 * A demonstration. The markup's resting state is the finished picture, so with reduced motion or no script a visitor
 * sees the outcome. Only here, after hydration, does a stage arm itself: `data-play` holds its [data-a] parts hidden
 * until it enters the view, plays them once, and arms again when it has left the view completely.
 */
function Stage({ className = "", say, sample = true, children }: { className?: string; say: Says; sample?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.dataset.play = "wait";
    setMoving(true);
    const enter = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) el.dataset.play = "on";
      },
      { rootMargin: "0px 0px -22% 0px" },
    );
    const leave = new IntersectionObserver(([e]) => {
      if (e && !e.isIntersecting) el.dataset.play = "wait";
    });
    enter.observe(el);
    leave.observe(el);
    return () => {
      enter.disconnect();
      leave.disconnect();
    };
  }, []);
  const replay = () => {
    const el = ref.current;
    if (!el) return;
    el.dataset.play = "wait";
    void el.offsetWidth; // the animations restart only if the browser has seen them stop
    el.dataset.play = "on";
  };
  return (
    <div ref={ref} className={`f-stage ${className}`.trim()} data-example={sample ? "" : undefined}>
      {children}
      {sample || moving ? (
        <div className="f-foot">
          {sample ? <p className="f-sample">{say.f.sample}</p> : <span />}
          {moving ? (
            <button type="button" className="f-again" onClick={replay} aria-label={say.f.again} title={say.f.again}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5L4.5 8.8M4.5 4v4.8h4.8" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Feature({
  id,
  name,
  title,
  body,
  how,
  flip,
  children,
}: {
  id: string;
  name: string;
  title: string;
  body: string;
  how: string;
  flip?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`f-feat${flip ? " is-flip" : ""}`} id={id} aria-labelledby={`${id}-h`}>
      <div className="f-words">
        <p className="f-name">{name}</p>
        <h2 className="f-h2" id={`${id}-h`}>
          {title}
        </h2>
        <p className="f-body">{body}</p>
        <p className="f-how">{how}</p>
      </div>
      {children}
    </section>
  );
}

function BriefDemo({ say }: { say: Says }) {
  const { f, s } = say;
  const chain: [string, string][] = [
    [f.whyFigure, s.why.figure],
    [f.whyRead, s.why.read],
    [f.whyRow, s.why.row],
    [f.whyDecision, s.why.decision],
    [f.whyApprover, s.why.approver],
  ];
  return (
    <Stage className="f-brief" say={say}>
      <Art name="dawn" sizes="(min-width: 1000px) 400px, 100vw" />
      <div className="f-card f-brief-list">
        <p className="f-card-h">{f.briefCard}</p>
        <ol>
          {s.brief.map(([what, much], i) => (
            <li key={what} data-a="rise" style={at(200 + i * 200)}>
              <span>{what}</span>
              <b className="f-amount">
                {much}
                {i === 0 ? (
                  <span className="f-ring" data-a="pop" style={at(1100)}>
                    <Ring />
                  </span>
                ) : null}
              </b>
            </li>
          ))}
        </ol>
      </div>
      <div className="f-card f-why">
        <p className="f-card-h">{f.whyCard}</p>
        <ol className="f-chain">
          {chain.map(([label, value], i) => (
            <li key={label} data-a="rise" style={at(1400 + i * 360)}>
              {i ? <i className="f-link" data-a="grow-y" style={at(1250 + i * 360)} /> : null}
              <small>{label}</small>
              <span>{value}</span>
            </li>
          ))}
        </ol>
      </div>
    </Stage>
  );
}

// Where each stack of packets sits on the painted shelf, as a share of the cropped picture (.f-shelf .s-art).
const STACKS = [
  { x: 2.2, w: 9.6, top: 26.9, bottom: 63.75, n: 7, first: 0 },
  { x: 12.6, w: 8.9, top: 28.1, bottom: 63.75, n: 7, first: 7 },
  { x: 86.3, w: 9.9, top: 25, bottom: 63.75, n: 7, first: 14 },
];

function Box({ x, y, w, h, start }: { x: number; y: number; w: number; h: number; start: number }) {
  return (
    <span className="f-box" style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}>
      <i data-a="grow-x" style={at(start)} />
      <i data-a="grow-y" style={at(start + 40)} />
      <i data-a="grow-x" style={at(start + 80)} />
      <i data-a="grow-y" style={at(start + 120)} />
    </span>
  );
}

function ShelfDemo({ say }: { say: Says }) {
  const { f, s } = say;
  return (
    <Stage className="f-shelf" say={say}>
      <Art name="shelf-gaps" sizes={half}>
        <i className="f-shutter" data-a="shutter" />
        <span className="f-tag" style={{ left: "2.2%", top: "13.5%", ...at(350) }} data-a="pop">
          {s.shelf.product}
        </span>
        <div aria-hidden="true">
          {STACKS.map((st, k) => {
            const h = (st.bottom - st.top) / st.n;
            return Array.from({ length: st.n }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed drawing.
              <Box key={`${k}-${i}`} x={st.x} y={st.bottom - (i + 1) * h} w={st.w} h={h} start={800 + (st.first + i) * 70} />
            ));
          })}
          <span className="f-gapzone" data-a="pop" style={at(3000)}>
            {f.shelfGap} {s.shelf.gap}
          </span>
        </div>
      </Art>
      <ol className="f-steps3">
        <li data-a="rise" style={at(100)}>
          <b lang="en">{SHELF_MODELS.names}</b>
          <span>{f.shelfNames}</span>
        </li>
        <li data-a="rise" style={at(800)}>
          <b lang="en">{SHELF_MODELS.finds}</b>
          <span>{f.shelfFinds}</span>
        </li>
        <li data-a="rise" style={at(2300)}>
          <b>{f.shelfCode}</b>
          <span>{f.shelfCounts}</span>
        </li>
      </ol>
      <dl className="f-tally">
        <div data-a="rise" style={at(2500)}>
          <dt>{f.shelfBooks}</dt>
          <dd>{s.shelf.books}</dd>
        </div>
        <div data-a="rise" style={at(2700)}>
          <dt>{f.shelfSeen}</dt>
          <dd>{s.shelf.seen}</dd>
        </div>
        <div className="is-gap" data-a="pop" style={at(3000)}>
          <dt>{f.shelfGap}</dt>
          <dd>{s.shelf.gap}</dd>
        </div>
      </dl>
    </Stage>
  );
}

function BillDemo({ say }: { say: Says }) {
  const { f, s } = say;
  return (
    <Stage className="f-bill" say={say}>
      <Art name="bill" sizes={half}>
        <i className="f-scan" data-a="scan" />
      </Art>
      <div className="f-card f-bill-card">
        <div className="f-card-top">
          <p className="f-card-h">{f.billDraft}</p>
          <span className="s-status f-loop">{s.bill.supplier}</span>
        </div>
        <ul className="f-lines">
          {s.bill.lines.map(([what, qty, much], i) => (
            <li key={what} data-a="fly" style={at(900 + i * 420)}>
              <span>{what}</span>
              <span>{qty}</span>
              <b>{much}</b>
            </li>
          ))}
          <li className="is-total" data-a="rise" style={at(2300)}>
            <span>{s.bill.total[0]}</span>
            <span />
            <b>{s.bill.total[1]}</b>
          </li>
        </ul>
        <p className="f-small" data-a="rise" style={at(2500)}>
          {f.billAsRead} · {f.billSupplier}
        </p>
      </div>
    </Stage>
  );
}

function AskDemo({ say }: { say: Says }) {
  const { f, s, w, hindi } = say;
  const spoken = hindi ? "hi" : "hi-Latn";
  return (
    <Stage className="f-ask" say={say}>
      <Art name="ask" sizes={half} />
      <div className="f-card f-thread">
        <div className="f-said" data-a="rise" style={at(100)}>
          <Wave />
          <p lang={spoken}>{s.ask.said}</p>
          {s.ask.tr ? <small lang="en">{s.ask.tr}</small> : null}
          <small>{f.askBy}</small>
        </div>
        <div className="f-answer" data-a="rise" style={at(900)}>
          <p className="s-who">
            <Mark />
            {f.askWho}
          </p>
          <p>
            {s.ask.answer.map((part, i) =>
              typeof part === "string" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: the answer's runs are fixed and never reorder.
                <span key={i}>{part}</span>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: as above.
                <b key={i} className="f-cited">
                  {part.fig}
                </b>
              ),
            )}
          </p>
        </div>
        <div className="f-said is-short" data-a="rise" style={at(1900)}>
          <p lang={spoken}>{s.ask.said2}</p>
        </div>
        <p className="f-cannot" data-a="pop" style={at(2600)}>
          <b>{w.cannotVerify}</b>
          <span>{s.ask.why}</span>
        </p>
      </div>
    </Stage>
  );
}

function ApproveDemo({ say }: { say: Says }) {
  const { f, s, w } = say;
  return (
    <Stage className="f-approve" say={say}>
      <div className="f-tray">
        <p className="f-tray-h">{f.approveTray}</p>
        <div className="f-pile" aria-hidden="true">
          <i />
          <i />
        </div>
        <article className="f-draft" data-a="drop" style={at(200)}>
          <small>{f.approveDrafted}</small>
          <b>{s.approve.title}</b>
          <span>{s.approve.line}</span>
          <em className="f-wait" data-a="flash" style={at(900)}>
            {f.approveWaiting}
          </em>
          <span className="f-seal" data-a="stamp" style={at(2100)}>
            <span className="s-stamp is-ink">
              <span className="s-ringed">
                {w.stampApproved}
                <Ring />
              </span>
              <small>{f.approveBy}</small>
            </span>
          </span>
        </article>
      </div>
      <p className="f-ran" data-a="rise" style={at(2600)}>
        {f.approveRan}
      </p>
    </Stage>
  );
}

function CreditDemo({ say }: { say: Says }) {
  const { f, s, hindi } = say;
  const spoken = hindi ? "hi" : "hi-Latn";
  return (
    <Stage className="f-credit" say={say}>
      <Art name="credit" sizes={half} />
      <div className="f-card f-credit-book">
        <p className="f-card-h">{f.creditBook}</p>
        <ul className="f-lines">
          {s.credit.rows.map(([who, since, much], i) => (
            <li key={who} className={i === 0 ? "is-picked" : undefined} data-a="rise" style={at(200 + i * 160)}>
              <span>{who}</span>
              <span>{since}</span>
              <b>{much}</b>
            </li>
          ))}
        </ul>
      </div>
      <div className="f-credit-drafts">
        <div className="f-bubble" data-a="fly" style={at(1000)}>
          <small>{f.creditReminder}</small>
          <p lang={spoken}>{s.credit.message}</p>
        </div>
        <div className="f-paylink" data-a="fly" style={at(1500)}>
          <small>{f.creditLink}</small>
          <span className="s-sticker">{f.paypalLine}</span>
        </div>
      </div>
      <ol className="f-flow">
        <li data-a="rise" style={at(2100)}>
          {f.creditPaid}
        </li>
        <li data-a="rise" style={at(2400)}>
          {f.creditFinding}
        </li>
        <li data-a="rise" style={at(2700)}>
          {f.creditRecord}
        </li>
      </ol>
    </Stage>
  );
}

const SEATS: [string, keyof FeatureWords][] = [
  ["Munshi", "deskMunshi"],
  ["Tally", "deskTally"],
  ["Ledger", "deskLedger"],
  ["Dash", "deskDash"],
  ["Echo", "deskEcho"],
  ["Bloom", "deskBloom"],
  ["Keeper", "deskKeeper"],
];

function OfficeDemo({ say }: { say: Says }) {
  const { f, s } = say;
  const kinds = [f.officeRead, f.officeModel, f.officeChecked, f.officeProposed];
  return (
    <Stage className="f-office" say={say}>
      <ul className="f-seats">
        {SEATS.map(([name, desk], i) => (
          <li key={name} className={name === "Tally" ? "is-busy" : undefined} data-a="pop" style={at(i * 90)}>
            <span className="f-seat" aria-hidden="true">
              {name === "Tally" ? <i className="f-pulse" /> : null}
              {name[0]}
            </span>
            <b lang="en">{name}</b>
            <small>{f[desk]}</small>
          </li>
        ))}
      </ul>
      <div className="f-card f-log">
        <div className="f-card-top">
          <p className="f-card-h">{f.officeLog}</p>
          <span className="f-run">{s.office.run}</span>
        </div>
        <p className="f-small">{f.officeSteps}</p>
        <ol className="f-trace">
          {s.office.steps.map(([label, time], i) => (
            <li key={label} data-a="rise" style={at(900 + i * 480)}>
              <b>{kinds[i]}</b>
              <span>{label}</span>
              <small>{time}</small>
            </li>
          ))}
        </ol>
      </div>
    </Stage>
  );
}

function CampaignDemo({ say }: { say: Says }) {
  const { f } = say;
  const progress = [f.campaignWrites, f.campaignTest, f.campaignDraft];
  return (
    <Stage className="f-campaign" say={say} sample={false}>
      <article className="f-post" data-a="rise">
        <Art name="shop" sizes="(min-width: 1000px) 340px, 90vw" />
        <p className="f-post-copy" data-a="rise" style={at(600)}>
          {f.campaignCopy}
        </p>
        <p className="f-chips" lang="en" data-a="rise" style={at(1000)}>
          <span>WhatsApp</span>
          <span>Instagram</span>
        </p>
      </article>
      <div className="f-campaign-side">
        <ol className="f-ticks">
          {progress.map((label, i) => (
            <li key={label} className={i === 2 ? "is-now" : undefined} data-a="fly" style={at(1400 + i * 520)}>
              {label}
            </li>
          ))}
        </ol>
        <div className="f-tray-mini">
          <p className="f-tray-h">{f.approveTray}</p>
          <i data-a="drop" style={at(2500)} />
        </div>
      </div>
    </Stage>
  );
}

function SiteDemo({ say }: { say: Says }) {
  const { f, s } = say;
  return (
    <Stage className="f-site" say={say}>
      <Art name="lane" sizes={half} />
      <div className="f-phone">
        <p className="f-phone-h">{s.site.shop}</p>
        <p className="f-small">{s.site.service}</p>
        <p className="f-phone-l">{f.siteFree}</p>
        <ul className="f-slots">
          {s.site.times.map((t, i) => (
            <li key={t} data-a="pop" style={at(200 + i * 110)} className={t === s.site.picked ? "is-picked" : undefined}>
              {t}
            </li>
          ))}
        </ul>
        <div className="f-held" data-a="rise" style={at(1300)}>
          <span>{f.siteHeld}</span>
          <i className="f-meter">
            <i data-a="drain" style={at(1400)} />
          </i>
        </div>
        <p className="f-step-line" data-a="rise" style={at(2200)}>
          {f.siteSent}
        </p>
        <p className="f-step-line is-last" data-a="rise" style={at(2700)}>
          {f.siteConfirm}
        </p>
      </div>
    </Stage>
  );
}

function EveryDay({ say }: { say: Says }) {
  const { f, s, hindi } = say;
  return (
    <section className="f-day" id="counter" aria-labelledby="counter-h">
      <div className="f-day-head">
        <p className="f-name">{f.dayName}</p>
        <h2 className="f-h2" id="counter-h">
          {f.dayTitle}
        </h2>
        <p className="f-body">{f.dayBody}</p>
      </div>
      <div className="f-day-grid">
        <div className="f-day-lead">
          <Stage className="f-counter" say={say}>
            <Art name="rush" sizes="(min-width: 1000px) 720px, 100vw" />
            <div className="f-card f-receipt">
              <ul className="f-lines">
                {s.counter.items.map(([what, much], i) => (
                  <li key={what} data-a="fly" style={at(200 + i * 300)}>
                    <span>{what}</span>
                    <b>{much}</b>
                  </li>
                ))}
                <li className="is-total" data-a="rise" style={at(1200)}>
                  <span>{s.counter.total[0]}</span>
                  <b>{s.counter.total[1]}</b>
                </li>
              </ul>
              <p className="f-pay" data-a="rise" style={at(1500)}>
                <span className="is-on">{f.counterUpi}</span>
                <span>{f.counterCash}</span>
                <span>{f.counterCredit}</span>
              </p>
            </div>
          </Stage>
          <div className="f-mini-w">
            <h3>{f.counterName}</h3>
            <p>{f.counterBody}</p>
          </div>
        </div>
        <div className="f-mini">
          <Stage className="f-roles" say={say} sample={false}>
            <ul>
              <li data-a="rise">
                <b>{f.staffOwner}</b>
                <i className="f-bar is-full" data-a="grow-x" style={at(200)} />
              </li>
              <li data-a="rise" style={at(200)}>
                <b>{f.staffManager}</b>
                <i className="f-bar is-most" data-a="grow-x" style={at(400)} />
              </li>
              <li data-a="rise" style={at(400)}>
                <b>{f.staffCounter}</b>
                <i className="f-bar is-some" data-a="grow-x" style={at(600)} />
              </li>
            </ul>
          </Stage>
          <div className="f-mini-w">
            <h3>{f.staffName}</h3>
            <p>{f.staffBody}</p>
          </div>
        </div>
        <div className="f-mini">
          <Stage className="f-offline" say={say}>
            <p className="f-off-state" data-a="pop">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9.5a12 12 0 0 1 16 0M7.5 13a7 7 0 0 1 9 0M11 16.5a2 2 0 0 1 2 0M4 4l16 16" />
              </svg>
              {f.offlineState}
            </p>
            <ul className="f-lines">
              {s.offline.map(([what, much], i) => (
                <li key={what} data-a="rise" style={at(300 + i * 200)}>
                  <span>{what}</span>
                  <b>{much}</b>
                </li>
              ))}
            </ul>
          </Stage>
          <div className="f-mini-w">
            <h3>{f.offlineName}</h3>
            <p>{f.offlineBody}</p>
          </div>
        </div>
        <div className="f-mini">
          <Stage className="f-lang-demo" say={say} sample={false}>
            <p className="f-swap" lang={hindi ? "hi" : "en"} data-a="rise">
              {f.hindiA}
            </p>
            <p className="f-swap is-b" lang={hindi ? "en" : "hi-Latn"} data-a="rise" style={at(700)}>
              {f.hindiB}
            </p>
          </Stage>
          <div className="f-mini-w">
            <h3>{f.hindiName}</h3>
            <p>{f.hindiBody}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function GuardDemo({ say }: { say: Says }) {
  const { f } = say;
  const rules: [keyof FeatureWords, keyof FeatureWords][] = [
    ["guardRule1", "guardRule1Body"],
    ["guardRule2", "guardRule2Body"],
    ["guardRule3", "guardRule3Body"],
    ["guardRule4", "guardRule4Body"],
  ];
  const route = [f.guardAgent, f.guardTray, f.guardPerson, f.guardGuard, f.guardBooks];
  return (
    <section className="s-paper f-guard" id="guarantee" aria-labelledby="guarantee-h">
      <div className="f-col">
        <p className="f-name">{f.guardName}</p>
        <h2 className="f-h2" id="guarantee-h">
          {f.guardTitle}
        </h2>
        <p className="f-body">{f.guardBody}</p>
        <Stage className="f-paths" say={say} sample={false}>
          <div className="f-path is-no">
            <p className="f-path-h">{f.guardDirect}</p>
            <div className="f-route">
              <span className="f-node">{f.guardAgent}</span>
              <span className="f-wire">
                <i className="f-try" data-a="refuse" style={at(300)} />
              </span>
              <span className="f-node is-wall">{f.guardGuard}</span>
              <span className="f-cross" data-a="stamp" style={at(1000)}>
                {f.guardRefused}
              </span>
            </div>
          </div>
          <div className="f-path">
            <p className="f-path-h">{f.guardPath}</p>
            <ol className="f-route is-way">
              {route.map((label, i) => (
                <li key={label} data-a="pop" style={at(1500 + i * 420)}>
                  {i ? <i className="f-wire-s" data-a="grow-way" style={at(1350 + i * 420)} /> : null}
                  <span className={`f-node${i === 2 ? " is-person" : ""}${i === 4 ? " is-books" : ""}`}>{label}</span>
                  {i === 2 ? <small>{f.guardApproved}</small> : null}
                </li>
              ))}
            </ol>
          </div>
        </Stage>
        <ul className="f-rules">
          {rules.map(([t, b]) => (
            <li key={t}>
              <h3>{f[t]}</h3>
              <p>{f[b]}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** The features page: each job shown working on a sample, in the order a shop's day meets them. */
export function Features() {
  const { lang } = useLang();
  const f = FEATURE_WORDS[lang];
  const w = SITE_WORDS[lang];
  const say: Says = { f, s: FEATURE_SAMPLE[lang], w, hindi: lang === "hi" };
  const index: [string, string][] = [
    ["brief", f.briefName],
    ["shelf", f.shelfName],
    ["bills", f.billName],
    ["ask", f.askName],
    ["approvals", f.approveName],
    ["credit", f.creditName],
    ["office", f.officeName],
    ["campaigns", f.campaignName],
    ["storefront", f.siteName],
    ["counter", f.dayName],
    ["guarantee", f.guardName],
  ];
  return (
    <div className="f-page">
      <section className="f-hero" aria-labelledby="features-h">
        <div className="f-hero-words">
          <h1 className="s-h1" id="features-h">
            {f.title}
          </h1>
          <p className="s-hero-lede">{f.lede}</p>
          <p className="s-fence">{w.fence}</p>
        </div>
        <div className="f-hero-art">
          <figure className="is-a">
            <Art name="shop" sizes="(min-width: 1000px) 560px, 92vw" eager />
            <figcaption>{f.dayOpen}</figcaption>
          </figure>
          <figure className="is-b">
            <Art name="rush" sizes="(min-width: 1000px) 340px, 46vw" eager />
            <figcaption>{f.dayRush}</figcaption>
          </figure>
          <figure className="is-c">
            <Art name="close" sizes="(min-width: 1000px) 340px, 46vw" eager />
            <figcaption>{f.dayClose}</figcaption>
          </figure>
        </div>
      </section>

      <nav className="f-index" aria-label={f.indexLabel}>
        <ul>
          {index.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="f-col">
        <Feature id="brief" name={f.briefName} title={f.briefTitle} body={f.briefBody} how={f.briefHow}>
          <BriefDemo say={say} />
        </Feature>
        <Feature id="shelf" name={f.shelfName} title={f.shelfTitle} body={f.shelfBody} how={f.shelfHow} flip>
          <ShelfDemo say={say} />
        </Feature>
        <Feature id="bills" name={f.billName} title={f.billTitle} body={f.billBody} how={f.billHow}>
          <BillDemo say={say} />
        </Feature>
        <Feature id="ask" name={f.askName} title={f.askTitle} body={f.askBody} how={f.askHow} flip>
          <AskDemo say={say} />
        </Feature>
        <Feature id="approvals" name={f.approveName} title={f.approveTitle} body={f.approveBody} how={f.approveHow}>
          <ApproveDemo say={say} />
        </Feature>
        <Feature id="credit" name={f.creditName} title={f.creditTitle} body={f.creditBody} how={f.creditHow} flip>
          <CreditDemo say={say} />
        </Feature>
        <Feature id="office" name={f.officeName} title={f.officeTitle} body={f.officeBody} how={f.officeHow}>
          <OfficeDemo say={say} />
        </Feature>
        <Feature id="campaigns" name={f.campaignName} title={f.campaignTitle} body={f.campaignBody} how={f.campaignHow} flip>
          <CampaignDemo say={say} />
        </Feature>
        <Feature id="storefront" name={f.siteName} title={f.siteTitle} body={f.siteBody} how={f.siteHow}>
          <SiteDemo say={say} />
        </Feature>
        <EveryDay say={say} />
      </div>

      <GuardDemo say={say} />

      <section className="f-col f-end" aria-labelledby="features-cta-h">
        <div>
          <h2 className="s-h2" id="features-cta-h">
            {f.ctaTitle}
          </h2>
          <p className="s-lede">{f.ctaBody}</p>
          <Ctas w={w} />
          <p className="s-fence f-end-fence">
            {w.fence} · {f.paypalLine}
          </p>
        </div>
        <Art name="close" sizes="(min-width: 1000px) 520px, 100vw" />
      </section>
    </div>
  );
}
