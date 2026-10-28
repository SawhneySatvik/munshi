"use client";

import { useEffect, useState } from "react";

/** Category chips that jump to their section and mark the one in view. */
export function ChipNav({ items, label }: { items: { id: string; label: string }[]; label: string }) {
  const [current, setCurrent] = useState(items[0]?.id);
  useEffect(() => {
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = items.find((i) => seen.get(i.id));
        if (first) setCurrent(first.id);
      },
      { rootMargin: "-90px 0px -55% 0px" },
    );
    for (const i of items) {
      const el = document.getElementById(i.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [items]);
  return (
    <nav className="chip-nav" aria-label={label}>
      <ul className="wrap">
        {items.map((i) => (
          <li key={i.id}>
            <a href={`#${i.id}`} aria-current={i.id === current ? "true" : undefined} onClick={() => setCurrent(i.id)}>
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
