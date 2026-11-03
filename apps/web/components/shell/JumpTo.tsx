"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fillText } from "../../lib/i18n";
import { OPS } from "../../lib/i18n-ops";
import { ALSO, HREF, HUBS, LABEL, type Section } from "../../lib/nav";
import { useFeatureOn } from "../AiFeatures";
import { useAsk } from "../AskProvider";
import { useLang } from "../LangProvider";
import "./JumpTo.css";

type Item = { kind: "go"; section: Section } | { kind: "ask" };

/**
 * Jump to: every section the member can open, by hub, narrowed as they type (either language's label, or another word
 * the section answers to). Enter opens the chosen row; a question that matches no section goes to Ask. A modal dialog
 * centred on a desk, a sheet rising from the bottom on a phone. The parent opens it (the rail's button, "More", ⌘K).
 */
export function JumpTo({ sections, open, onClose }: { sections: readonly Section[]; open: boolean; onClose: () => void }) {
  const { lang } = useLang();
  const o = OPS[lang];
  const router = useRouter();
  const { send } = useAsk();
  // Ask switched off for the shop by the operator (D-079 §8): no "ask this" row.
  const askOn = useFeatureOn("ask");
  const dialog = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setQ("");
      setAt(0);
      d.showModal?.();
    } else if (!open && d.open) d.close?.();
  }, [open]);

  const words = q.trim().toLowerCase();
  const matches = (s: Section) =>
    !words || [OPS.en[LABEL[s]], OPS.hi[LABEL[s]], ...(ALSO[s] ?? [])].some((w) => w.toLowerCase().includes(words));
  const groups = [...HUBS, { label: "navSettings" as const, sections: ["settings"] as Section[] }]
    .map((g) => ({ label: g.label, sections: g.sections.filter((s) => sections.includes(s) && matches(s)) }))
    .filter((g) => g.sections.length > 0);
  const items: Item[] = [...groups.flatMap((g) => g.sections.map((section) => ({ kind: "go" as const, section }))), ...(words && askOn ? [{ kind: "ask" as const }] : [])];
  const chosen = Math.min(at, Math.max(items.length - 1, 0));

  const run = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    if (item.kind === "go") {
      router.push(HREF[item.section]);
      return;
    }
    const form = new FormData();
    form.set("question", q.trim());
    router.push("/app/ask");
    void send(form);
  };

  const indexOf = (s: Section) => items.findIndex((i) => i.kind === "go" && i.section === s);

  return (
    <dialog ref={dialog} className="jump" aria-label={o.jumpLabel} onClose={onClose} onCancel={onClose}>
      <form
        method="dialog"
        className="jump-in"
        onSubmit={(e) => {
          e.preventDefault();
          run(items[chosen]);
        }}
      >
        <span className="jump-grip" aria-hidden="true" />
        <label className="jump-q">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M20 20l-4.3-4.3" />
          </svg>
          <span className="vh">{o.jumpLabel}</span>
          <input
            type="text"
            inputMode="search"
            value={q}
            placeholder={o.jumpLabel}
            autoComplete="off"
            enterKeyHint="go"
            aria-describedby="jump-keys"
            onChange={(e) => {
              setQ(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAt((chosen + 1) % Math.max(items.length, 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAt((chosen - 1 + items.length) % Math.max(items.length, 1));
              }
            }}
          />
        </label>
        <div className="jump-list">
          {groups.map((g) => (
            <section key={g.label} className="jump-group" aria-label={o[g.label]}>
              <p className="jump-h" aria-hidden="true">
                {o[g.label]}
              </p>
              <ul>
                {g.sections.map((s) => {
                  const i = indexOf(s);
                  return (
                    <li key={s}>
                      <button type="button" className="jump-row" data-on={i === chosen || undefined} onMouseMove={() => setAt(i)} onClick={() => run({ kind: "go", section: s })}>
                        {o[LABEL[s]]}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {words && groups.length === 0 && <p className="jump-none">{o.jumpNone}</p>}
          {words && askOn && (
            <button
              type="button"
              className="jump-row jump-ask"
              data-on={chosen === items.length - 1 || undefined}
              onMouseMove={() => setAt(items.length - 1)}
              onClick={() => run({ kind: "ask" })}
            >
              {fillText(o.jumpAsk, { q: q.trim() })}
            </button>
          )}
        </div>
        <p id="jump-keys" className="jump-keys">
          {o.jumpKeys}
        </p>
      </form>
    </dialog>
  );
}
