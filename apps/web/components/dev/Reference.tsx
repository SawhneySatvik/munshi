"use client";

import { useState } from "react";

export type RefParam = { name: string; in: string; required: boolean };
export type RefRoute = {
  op: string;
  method: string;
  path: string;
  summary: string;
  auth: string;
  status: number;
  body: string | null;
  response: string;
  params: RefParam[];
  errors: string[];
  cache: string;
  writes: string | null;
  deferred: boolean;
  example: { request: string; body: string } | null;
};

const AUTH = { none: "No key", publishable: "Publishable key", secret: "Secret key" } as Record<string, string>;

/** Every route of API v1, filtered as you type (by path, operation or summary). */
export function Reference({ routes }: { routes: RefRoute[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = routes.filter((r) => !needle || `${r.method} ${r.path} ${r.op} ${r.summary}`.toLowerCase().includes(needle));
  return (
    <div className="d-ref">
      <label className="d-search">
        <span>Search the routes</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="orders, slots, POST…" />
      </label>
      <p className="d-count" aria-live="polite">
        {shown.length === routes.length ? "Every route" : shown.length ? "Matching routes" : "No route matches"}
      </p>
      {shown.map((r) => (
        <section key={r.op} id={r.op} className="d-route" data-op={r.op}>
          <h2>
            <span className={`d-method d-${r.method.toLowerCase()}`}>{r.method}</span> <code>/api/v1{r.path}</code>
          </h2>
          <p>{r.summary}</p>
          {r.deferred ? <p className="d-note">Not open yet: this route answers not_found until the shop's secret keys ship.</p> : null}
          <dl className="d-facts">
            <dt>Operation</dt>
            <dd>
              <code>{r.op}</code>
            </dd>
            <dt>Auth</dt>
            <dd>{AUTH[r.auth] ?? r.auth}</dd>
            <dt>Answers</dt>
            <dd>
              <code>{r.status}</code> <code>{r.response}</code>
            </dd>
            {r.params.length ? (
              <>
                <dt>Parameters</dt>
                <dd>
                  {r.params.map((p) => (
                    <span key={`${p.in}-${p.name}`} className="d-param">
                      <code>{p.name}</code> {p.in}
                      {p.required ? ", required" : ""}
                    </span>
                  ))}
                </dd>
              </>
            ) : null}
            {r.body ? (
              <>
                <dt>Body</dt>
                <dd>
                  <code>{r.body}</code> (JSON)
                </dd>
              </>
            ) : null}
            {r.writes ? (
              <>
                <dt>Stores</dt>
                <dd>{r.writes}</dd>
              </>
            ) : null}
            <dt>Errors</dt>
            <dd>
              {r.errors.map((e) => (
                <code key={e} className="d-err">
                  {e}
                </code>
              ))}
            </dd>
            <dt>Cache</dt>
            <dd>
              <code>{r.cache}</code>
            </dd>
          </dl>
          {r.example ? (
            <details className="d-example">
              <summary>Example, recorded from the demo's showcase shops (synthetic)</summary>
              <pre className="d-code">
                <code>{`${r.example.request}\n\n${r.example.body}`}</code>
              </pre>
            </details>
          ) : null}
        </section>
      ))}
    </div>
  );
}
