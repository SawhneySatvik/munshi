// Elite's drawings (elite-A, design/options-2/shops.html): an arched salon mirror on a console, a bud vase and a comb,
// in one line weight. Colours are the look's CSS variables, so the same drawing serves the dark and the light mode.
import type { Art } from "../../lib/business.ts";

function Mark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M9 28V13a7 7 0 0 1 14 0v15" />
      <path d="M6 28h20" />
      <path d="M13 15l4-4" opacity=".5" />
    </svg>
  );
}

const LEAF = "M0 0Q11 -7 22 0Q11 7 0 0Z";

function Hero() {
  return (
    <svg className="mirror" viewBox="0 0 480 440" role="img" aria-label="Drawing: an arched salon mirror on a console, a bud vase and a comb">
      <ellipse cx="240" cy="414" rx="200" ry="8" className="m-shadow" />
      <path d="M146 404V172a94 94 0 0 1 188 0v232Z" className="m-glass" />
      <path className="m-gleam" d="M160 300V180a80 80 0 0 1 60 -76" fill="none" strokeWidth="10" strokeLinecap="round" />
      <g className="m-line" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path className="draw" pathLength={1} d="M130 404V170a110 110 0 0 1 220 0v234" />
        <path className="draw d2" pathLength={1} d="M146 404V172a94 94 0 0 1 188 0v232" opacity=".5" />
        <path className="draw d3" pathLength={1} d="M48 404h384" />
        <path className="fade" d="M178 214l46-46M184 250l74-74" opacity=".35" />
        <g className="fade f2">
          <path d="M74 404c-8-24-6-44 10-54v-14h12v14c16 10 18 30 10 54Z" className="m-fill" fillOpacity=".12" />
          <path d="M90 336c-2-34 8-58 20-86" />
          <g className="m-fill" fillOpacity=".22">
            <path d={LEAF} transform="translate(92 312) rotate(-150)" />
            <path d={LEAF} transform="translate(93 292) rotate(-30)" />
            <path d="M0 0Q10 -6 20 0Q10 6 0 0Z" transform="translate(99 272) rotate(-160)" />
            <path d="M0 0Q9 -6 18 0Q9 6 0 0Z" transform="translate(103 262) rotate(-40)" />
          </g>
          <path d="M110 239Q110 244 115 244Q110 244 110 249Q110 244 105 244Q110 244 110 239Z" />
        </g>
        <g className="fade f3">
          <rect x="368" y="386" width="88" height="9" rx="3" className="m-fill" fillOpacity=".14" />
          <path d="M374 394v9M384.8 394v9M395.6 394v9M406.4 394v9M417.2 394v9M428 394v9M438.8 394v9M449.6 394v9" strokeWidth="1.3" />
        </g>
      </g>
      <g className="m-spark">
        <path d="M392 137Q392 150 405 150Q392 150 392 163Q392 150 379 150Q392 150 392 137Z" />
        <path d="M416 205Q416 212 423 212Q416 212 416 219Q416 212 409 212Q416 212 416 205Z" />
        <path d="M370 92Q370 98 376 98Q370 98 370 104Q370 98 364 98Q370 98 370 92Z" />
      </g>
    </svg>
  );
}

// A stylist's portrait frame until a photo arrives (with the person's agreement): an arch with the initial.
function Plate({ kind }: { kind: string }) {
  return (
    <svg className="plate" viewBox="0 0 120 150" aria-hidden="true">
      <path d="M14 146V60a46 46 0 0 1 92 0v86Z" className="m-glass" />
      <path d="M14 146V60a46 46 0 0 1 92 0v86" className="m-line" fill="none" strokeWidth="1.6" />
      <text x="60" y="104" textAnchor="middle" className="plate-initial">
        {kind.slice(0, 1).toUpperCase()}
      </text>
    </svg>
  );
}

export const art: Art = { Mark, Hero, Plate };
