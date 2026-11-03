"use client";

import { type ReactNode, useState, useTransition } from "react";
import { whyNumber } from "../app/app/why-actions";
import { fill } from "../lib/i18n";
import { MEMORY } from "../lib/i18n-memory";
import type { WhyNode, WhyResult } from "../lib/server/memory";
import type { SourceRef } from "../lib/types";
import { When } from "./app/Kit";
import { CannotVerify } from "./CannotVerify";
import { useLang } from "./LangProvider";
import "./WhyChain.css";

/**
 * "Why this number" in the source drawer: on request, the walk from the figure to the snapshot it was read from,
 * the book row behind it, the decision that wrote that row and who approved it, then what the approver saw. A total ends
 * at its read, whole ("a total read from the books"), as does a read of the shop's other records. Drawn as a
 * chain of nested ordered lists, so the graph is its own list fallback for a screen reader and wraps on a phone. A link
 * that cannot be walked shows "Cannot verify" where it breaks.
 */
export function WhyChain({ shown }: { shown: SourceRef }) {
  const { lang } = useLang();
  const t = MEMORY[lang];
  const [result, setResult] = useState<WhyResult | null>(null);
  const [pending, start] = useTransition();
  const ask = () =>
    start(async () => {
      setResult(await whyNumber({ snapshotId: shown.snapshotId, row: shown.row, col: shown.col }).catch((): WhyResult => ({ error: "other" })));
    });
  return (
    <section className="why" aria-labelledby="why-h">
      <h3 id="why-h" className="why-h">
        {t.whyTitle}
      </h3>
      {!result && (
        <button type="button" className="why-ask" onClick={ask} disabled={pending} aria-busy={pending || undefined}>
          {pending ? t.whyLoading : t.whyShow}
        </button>
      )}
      <div role="status">
        {result && "error" in result && <p className="why-error">{result.error === "not_for_role" ? t.whyRefused : t.whyFailed}</p>}
      </div>
      {result && "nodes" in result && <Chain nodes={result.nodes} />}
    </section>
  );
}

/** The walk as a tree from its root (the figure, or the break where it could not start), by each node's parent. */
export function Chain({ nodes }: { nodes: WhyNode[] }) {
  const { lang } = useLang();
  const saw = MEMORY[lang].saw;
  const under = (parent: string | null) => nodes.filter((n) => n.parent === parent);
  const branch = (parent: string | null, seen: Set<string>, label?: string): ReactNode => {
    const kids = under(parent);
    if (!kids.length) return null;
    return (
      <ol className="why-chain" aria-label={label}>
        {kids.map((n, i) => {
          const key = `${n.kind}-${n.node ?? "x"}-${i}`;
          const loop = n.node !== null && seen.has(n.node);
          const next = n.node === null || loop ? null : branch(n.node, new Set([...seen, n.node]), n.kind === "decision" ? saw : undefined);
          return (
            <li key={key} className={`why-node why-${n.kind}`}>
              <NodeText n={n} />
              {next}
            </li>
          );
        })}
      </ol>
    );
  };
  return <div className="why-graph">{branch(null, new Set())}</div>;
}

function NodeText({ n }: { n: WhyNode }) {
  const { lang } = useLang();
  const t = MEMORY[lang];
  const name = (s: string) => <span data-name="">{s}</span>;
  const code = (s: string) => <code className="why-code">{s}</code>;
  const when = n.at ? (
    <>
      {" · "}
      <When at={n.at} />
    </>
  ) : null;
  switch (n.kind) {
    case "figure":
      return <span className="why-text">{fill(t.figure, { label: code(n.label) })}</span>;
    case "read":
      return (
        <span className="why-text">
          {n.who
            ? fill(t.read, { query: code(n.label), who: name(n.who) })
            : fill(n.label.startsWith("watch.") ? t.readByWatcher : t.readByJob, { query: code(n.label) })}
          {when}
        </span>
      );
    case "row":
      return (
        <span className="why-text">
          {fill(t.row, { entity: code(n.label) })}
          {n.who && <> · {fill(t.writtenBy, { who: name(n.who) })}</>}
          {when}
        </span>
      );
    case "decision":
      return (
        <span className="why-text">
          <strong>{fill(t.decision, { who: name(n.who ?? t.someone), command: code(n.label) })}</strong>
          {when}
        </span>
      );
    case "total":
    case "end":
      return (
        <span className="why-text">
          {n.at ? fill(n.kind === "total" ? t.total : t.records, { when: <When at={n.at} />, query: code(n.label) }) : code(n.label)}
        </span>
      );
    default:
      return <CannotVerify>{BREAK[n.label] ? t[BREAK[n.label] as keyof typeof t] : t.noRows}</CannotVerify>;
  }
}

const BREAK: Record<string, string> = { no_rows: "noRows", no_book_row: "noBookRow", no_cell: "noCell", no_snapshot: "noSnapshot" };
