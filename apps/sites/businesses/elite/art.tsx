// Elite's drawings, made for this site: thick dark outlines, flat fills from the provisional palette, a soft shadow.
import type { ReactNode } from "react";
import type { Art } from "../../lib/business.ts";

const INK = "#2a1820";
const PLUM = "#6e2a55";
const PLUM_DARK = "#4b1f3b";
const ROSE = "#9b3f62";
const GOLD = "#d8b074";
const CHROME = "#d9d0cc";
const GLASS = "#f6e6e0";
const BAND = "#efe1d4";

const line = { stroke: INK, strokeWidth: 5, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
const thin = { stroke: INK, strokeWidth: 3, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

function Scissors({ ring = GOLD, blade = CHROME }: { ring?: string; blade?: string }) {
  // Drawn pointing right from the pivot at 0,0; callers rotate it.
  return (
    <g>
      <path d="M2 -3 L104 -30 Q112 -30 108 -22 L6 8 Z" fill={blade} {...line} />
      <path d="M2 3 L104 30 Q112 30 108 22 L6 -8 Z" fill={blade} {...line} />
      <path d="M-4 -6 L-22 -16" {...line} />
      <path d="M-4 6 L-22 16" {...line} />
      <ellipse cx="-40" cy="-22" rx="21" ry="15" fill={ring} {...line} />
      <ellipse cx="-40" cy="-22" rx="9" ry="5.5" fill="#fbf6f0" {...thin} />
      <ellipse cx="-40" cy="22" rx="21" ry="15" fill={ring} {...line} />
      <ellipse cx="-40" cy="22" rx="9" ry="5.5" fill="#fbf6f0" {...thin} />
      <circle cx="2" cy="0" r="6" fill={INK} />
    </g>
  );
}

function Hero() {
  return (
    <svg viewBox="0 0 480 440" role="img" aria-label="A drawing of a salon chair before an arched mirror, with scissors and a comb">
      <ellipse cx="248" cy="404" rx="186" ry="21" fill={BAND} />
      {/* the mirror */}
      <path d="M96 326 V150 A104 104 0 0 1 304 150 V326 Z" fill={GOLD} {...line} />
      <path d="M116 326 V152 A84 84 0 0 1 284 152 V326 Z" fill={GLASS} {...line} />
      <rect x="80" y="322" width="240" height="16" rx="7" fill={PLUM_DARK} {...line} />
      <path d="M150 140 L196 96 M156 176 L224 110" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" />
      {/* the chair */}
      <rect x="244" y="300" width="26" height="70" fill={CHROME} {...line} />
      <path d="M202 352 Q257 366 312 352" fill="none" stroke={INK} strokeWidth="12" strokeLinecap="round" />
      <path d="M202 352 Q257 366 312 352" fill="none" stroke={CHROME} strokeWidth="4" strokeLinecap="round" />
      <ellipse cx="257" cy="384" rx="82" ry="15" fill={CHROME} {...line} />
      <rect x="250" y="128" width="14" height="26" fill={CHROME} {...line} />
      <rect x="222" y="100" width="70" height="34" rx="16" fill={PLUM} {...line} />
      <path d="M190 280 C184 214 188 172 218 160 Q257 146 296 160 C326 172 330 214 324 280 Z" fill={PLUM} {...line} />
      <path d="M232 176 V262 M257 170 V264 M282 176 V262" stroke={PLUM_DARK} strokeWidth="4" strokeLinecap="round" />
      <rect x="166" y="230" width="22" height="58" fill={CHROME} {...line} />
      <rect x="326" y="230" width="22" height="58" fill={CHROME} {...line} />
      <rect x="146" y="216" width="62" height="22" rx="11" fill={PLUM_DARK} {...line} />
      <rect x="306" y="216" width="62" height="22" rx="11" fill={PLUM_DARK} {...line} />
      <rect x="170" y="266" width="174" height="44" rx="20" fill={PLUM} {...line} />
      <path d="M186 290 H328" stroke={PLUM_DARK} strokeWidth="4" strokeLinecap="round" />
      {/* the comb */}
      <g transform="translate(14 330) rotate(-10)">
        <path d="M14 40 V58 M26 40 V60 M38 40 V60 M50 40 V60 M62 40 V60 M74 40 V60 M86 40 V60 M98 40 V58" {...line} />
        <rect x="4" y="22" width="106" height="22" rx="8" fill={ROSE} {...line} />
      </g>
      {/* the scissors */}
      <g transform="translate(378 128) rotate(-118) scale(0.92)">
        <Scissors />
      </g>
      {/* a glint and a few dots */}
      <path d="M410 214 q4 14 18 18 q-14 4 -18 18 q-4 -14 -18 -18 q14 -4 18 -18z" fill={GOLD} {...thin} />
      <circle cx="78" cy="96" r="7" fill={ROSE} />
      <circle cx="440" cy="300" r="6" fill={ROSE} />
      <circle cx="44" cy="220" r="5" fill={ROSE} />
      <circle cx="300" cy="30" r="5" fill={ROSE} />
    </svg>
  );
}

function Story() {
  return (
    <svg viewBox="0 0 480 440" role="img" aria-label="A drawing of a hand mirror, a hair dryer and a jar of cream">
      <ellipse cx="240" cy="402" rx="186" ry="21" fill={BAND} />
      {/* hair dryer */}
      <g transform="translate(60 120)">
        <path d="M118 120 L152 270 Q156 290 136 292 L118 292 Q100 292 98 272 L86 130 Z" fill={PLUM} {...line} />
        <rect x="104" y="232" width="40" height="12" rx="4" fill={GOLD} {...thin} />
        <path d="M30 40 H160 A70 70 0 0 1 160 160 H30 Z" fill={PLUM} {...line} />
        <rect x="0" y="54" width="34" height="92" rx="10" fill={CHROME} {...line} />
        <circle cx="168" cy="100" r="34" fill={GOLD} {...line} />
        <circle cx="168" cy="100" r="13" fill={PLUM_DARK} {...line} />
        <path d="M-28 70 q-16 30 0 60 M-50 60 q-20 40 0 80" fill="none" stroke={ROSE} strokeWidth="5" strokeLinecap="round" />
      </g>
      {/* hand mirror */}
      <g transform="translate(330 160) rotate(14)">
        <rect x="-11" y="78" width="22" height="120" rx="11" fill={GOLD} {...line} />
        <ellipse cx="0" cy="0" rx="66" ry="84" fill={GOLD} {...line} />
        <ellipse cx="0" cy="0" rx="50" ry="68" fill={GLASS} {...line} />
        <path d="M-22 -30 L4 -52 M-24 0 L18 -38" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      </g>
      {/* jar */}
      <g transform="translate(250 318)">
        <rect x="-44" y="-18" width="88" height="22" rx="8" fill={ROSE} {...line} />
        <rect x="-40" y="4" width="80" height="58" rx="14" fill={GLASS} {...line} />
        <path d="M-22 30 H22" stroke={ROSE} strokeWidth="5" strokeLinecap="round" />
      </g>
      <circle cx="96" cy="70" r="7" fill={ROSE} />
      <circle cx="430" cy="60" r="6" fill={ROSE} />
      <circle cx="448" cy="330" r="5" fill={ROSE} />
      <path d="M200 80 q4 14 18 18 q-14 4 -18 18 q-4 -14 -18 -18 q14 -4 18 -18z" fill={GOLD} {...thin} />
    </svg>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="18.5" fill={PLUM} />
      <path d="M14.5 26 L25 8.5 M25.5 26 L15 8.5" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="13" cy="28.5" r="4" fill="none" stroke={GOLD} strokeWidth="2.6" />
      <circle cx="27" cy="28.5" r="4" fill="none" stroke={GOLD} strokeWidth="2.6" />
    </svg>
  );
}

const s = { stroke: INK, strokeWidth: 2.6, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

const ICONS: Record<string, ReactNode> = {
  hair: (
    <g>
      <path d="M22 26 L40 9 L42 12 L25 29 Z" fill={CHROME} {...s} />
      <path d="M26 26 L8 9 L6 12 L23 29 Z" fill={CHROME} {...s} />
      <circle cx="17" cy="36" r="6" fill={GOLD} {...s} />
      <circle cx="31" cy="36" r="6" fill={GOLD} {...s} />
      <circle cx="24" cy="27" r="1.8" fill={INK} />
    </g>
  ),
  skin: (
    <g>
      <path d="M24 6 C30 16 37 22 37 30 A13 13 0 0 1 11 30 C11 22 18 16 24 6 Z" fill="#efb9b0" {...s} />
      <path d="M18 30 a6 6 0 0 0 6 6" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="38" cy="10" r="2.5" fill={ROSE} />
    </g>
  ),
  nails: (
    <g>
      <rect x="18" y="5" width="12" height="15" rx="3" fill={PLUM_DARK} {...s} />
      <rect x="12" y="19" width="24" height="24" rx="7" fill={ROSE} {...s} />
      <path d="M18 27 v8" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  spa: (
    <g>
      <ellipse cx="24" cy="38" rx="16" ry="5.5" fill={CHROME} {...s} />
      <ellipse cx="24" cy="29" rx="12" ry="5" fill={GOLD} {...s} />
      <ellipse cx="24" cy="21" rx="8" ry="4" fill={CHROME} {...s} />
      <path d="M26 16 C26 9 32 5 39 5 C39 12 34 16 26 16 Z" fill="#7aa36a" {...s} />
    </g>
  ),
  grooming: (
    <g>
      <rect x="9" y="8" width="30" height="11" rx="3" fill={CHROME} {...s} />
      <path d="M11 13.5 h26" stroke={INK} strokeWidth="1.6" />
      <rect x="20" y="19" width="8" height="5" fill={GOLD} {...s} />
      <rect x="20.5" y="24" width="7" height="18" rx="3.5" fill={PLUM} {...s} />
    </g>
  ),
  bridal: (
    <g>
      <rect x="16" y="24" width="16" height="19" rx="3" fill={GOLD} {...s} />
      <rect x="18" y="15" width="12" height="10" fill={CHROME} {...s} />
      <path d="M18 15 V9 L30 4 V15 Z" fill={ROSE} {...s} />
      <circle cx="39" cy="12" r="2.5" fill={ROSE} />
      <circle cx="9" cy="20" r="2" fill={ROSE} />
    </g>
  ),
  packages: (
    <g>
      <rect x="8" y="18" width="32" height="24" rx="3" fill={PLUM} {...s} />
      <rect x="6" y="12" width="36" height="9" rx="2.5" fill={ROSE} {...s} />
      <path d="M24 12 V42" stroke={GOLD} strokeWidth="5" />
      <path d="M24 12 V42" fill="none" {...s} strokeWidth="1.4" />
      <path d="M24 12 C18 4 10 6 14 12 M24 12 C30 4 38 6 34 12" fill="none" {...s} />
    </g>
  ),
  academy: (
    <g>
      <path d="M4 18 L24 9 L44 18 L24 27 Z" fill={PLUM} {...s} />
      <path d="M13 22 V33 C13 37 35 37 35 33 V22 L24 27 Z" fill={PLUM_DARK} {...s} />
      <path d="M40 20 V31" {...s} />
      <circle cx="40" cy="33" r="2.5" fill={GOLD} {...s} />
    </g>
  ),
  chat: (
    <g>
      <path d="M8 34 L10 26 A15 15 0 1 1 17 37 Z" fill={GLASS} {...s} />
      <path d="M17 21 h14 M17 27 h9" {...s} />
    </g>
  ),
  tag: (
    <g>
      <path d="M6 24 V8 a2 2 0 0 1 2-2 H24 L42 24 L24 42 Z" fill={GOLD} {...s} />
      <circle cx="15" cy="15" r="3" fill="#fff" {...s} />
    </g>
  ),
  everyone: (
    <g>
      <circle cx="17" cy="16" r="6.5" fill={GOLD} {...s} />
      <circle cx="32" cy="18" r="5.5" fill={ROSE} {...s} />
      <path d="M5 40 c0-9 5-14 12-14 s12 5 12 14 Z" fill={PLUM} {...s} />
      <path d="M26 40 c0-7 2-12 7-12 s10 4 10 12 Z" fill={ROSE} {...s} />
    </g>
  ),
};

function Icon({ id }: { id: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      {ICONS[id] ?? ICONS.hair}
    </svg>
  );
}

// Elite sells services, not goods: there is no product photo to stand in for.
function Product() {
  return null;
}

export const art: Art = { Logo, Hero, Story, Icon, Product, trimFor: () => GOLD };
