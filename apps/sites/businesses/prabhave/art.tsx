// Prabhave's drawings (the prabhave-A and -C boards, design/options-2/shops.html): fine technical flats of the four
// kinds, drawn in one hairline over a tonal cloth plate, in frames cut to a photo's 4:5 so the shop's own photographs
// drop in later. No festive props, no costume. Colours come from CSS variables (--c1 cloth, --c2 its shadow).
import type { ReactNode } from "react";
import type { Art } from "../../lib/business.ts";

function Mark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M6 26C12 20 10 12 16 8s12 2 10 8-10 6-12 2 4-8 8-6" />
      <circle cx="6" cy="26" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

const FLATS: Record<string, ReactNode> = {
  unstitched: (
    <g>
      <rect x="20" y="52" width="80" height="18" rx="6" />
      <rect x="15" y="72" width="90" height="22" rx="7" />
      <path d="M15 88H105" strokeDasharray="2 2" />
      <rect x="10" y="96" width="100" height="24" rx="8" />
      <path d="M26 46V40H94V46M26 40L22 44M94 40L98 44" strokeWidth=".9" />
    </g>
  ),
  semi: (
    <g>
      <path d="M45 21C51 25 69 25 75 21L83 25L85 42C83 60 83 90 90 134H30C37 90 37 60 35 42L37 25Z" />
      <path d="M50 22C53 34 67 34 70 22" />
      <path d="M48 24C52 40 68 40 72 24" strokeDasharray=".1 3" strokeWidth="2" />
      <path d="M40 28L38 42C36 60 37 90 32 131M80 28L82 42C84 60 83 90 88 131" strokeDasharray="3 2.5" />
      <path d="M30 126H90" />
    </g>
  ),
  stitched: (
    <g transform="translate(0 2) scale(.3)">
      <path d="M176 60C188 68 212 68 224 60L256 72C268 76 276 86 280 100L300 184L276 192L258 128C252 160 250 190 252 220C262 300 276 370 288 436C230 446 170 446 112 436C124 370 138 300 148 220C150 190 148 160 142 128L124 192L100 184L120 100C124 86 132 76 144 72Z" />
      <path d="M176 60C184 86 216 86 224 60" />
      <path d="M166 66C176 104 224 104 234 66" strokeDasharray=".1 9" strokeWidth="2" />
      <path d="M115 414C172 424 228 424 285 414M125 436L131 384M275 436L269 384M200 84V134" />
    </g>
  ),
  dupattas: (
    <g>
      <path d="M10 26H110" />
      <path d="M28 26C26 60 22 100 18 128H52C50 100 50 60 52 26" />
      <path d="M64 26C66 56 70 86 76 112H104C98 86 94 56 92 26" />
      <path d="M20 120H51M76 106H102" strokeDasharray="2 2" />
      <path d="M36 30C35 60 33 96 30 126M80 30C82 56 86 82 90 110" />
      <path d="M22 128V134M30 128V135M38 128V134M46 128V135M80 112V118M88 112V119M96 112V118" />
    </g>
  ),
};

// A drape of cloth for the opening panorama: tonal folds, no figure.
function Hero() {
  return (
    <svg className="drape" viewBox="0 0 600 300" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Drawing: a length of pyaazi cloth falling in folds">
      <rect width="600" height="300" className="cloth" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <path
          key={i}
          d={`M${40 + i * 80} -10C${60 + i * 80} 90 ${20 + i * 80} 200 ${50 + i * 80} 310`}
          className="fold"
          strokeWidth={18 + (i % 3) * 8}
          fill="none"
        />
      ))}
      <path d="M0 252C120 236 220 262 320 248S520 236 600 250" className="selvedge" fill="none" />
      <path d="M0 262C120 246 220 272 320 258S520 246 600 260" className="selvedge" fill="none" strokeDasharray="2 6" />
    </svg>
  );
}

function Plate({ kind, tone = 0 }: { kind: string; tone?: number }) {
  return (
    <svg className="plate" viewBox="0 0 120 150" aria-hidden="true" style={{ "--tone": tone } as React.CSSProperties}>
      <rect width="120" height="150" className="cloth" />
      <rect width="120" height="150" className="weave" />
      <g className="flat" fill="none" stroke="currentColor" strokeWidth="1.1" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round">
        {FLATS[kind] ?? FLATS.stitched}
      </g>
    </svg>
  );
}

export const art: Art = { Mark, Hero, Plate };
