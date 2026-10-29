// Munshi's mark, drawn for the site: a speech bubble with a dot, the question and the record behind it.
export function Mark() {
  return (
    <svg className="s-mark-i" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2a8 8 0 1 0 5.4 13.9l2.6 1.6-.8-3A8 8 0 0 0 10 2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.2" fill="currentColor" />
    </svg>
  );
}

/** A hand-drawn ring around a word or a figure (the ledger's own mark for "look here"). */
export function Ring() {
  return (
    <svg className="s-ring" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <path d="M14 31C4 25 6 10 27 6c21-4 54-3 66 6 8 7 2 19-18 23-21 4-53 3-66-6C4 25 7 15 20 10" />
    </svg>
  );
}

/** A voice recording's bars, the spoken question. */
export function Wave() {
  const bars = [6, 10, 16, 22, 14, 8, 12, 20, 26, 18, 10, 6, 14, 22, 16, 10, 8, 12, 18, 10, 6, 4];
  return (
    <svg className="s-wave" viewBox="0 0 132 26" aria-hidden="true">
      {bars.map((h, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed drawing; the bars never reorder.
        <rect key={i} x={i * 6} y={(26 - h) / 2} width="3" height={h} rx="1.5" />
      ))}
    </svg>
  );
}
