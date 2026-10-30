// The suit shop's drawings, made for this site: thick dark outlines, flat festive fills, a soft shadow. The product
// drawings take their colours from CSS variables (--c1 the fabric, --c2 the trim) so a colour chip can recolour them.
import type { CSSProperties, ReactNode } from "react";
import type { Art } from "../../lib/business.ts";

const INK = "#2b1411";
const RANI = "#c2285f";
const RANI_DARK = "#8f1546";
const MARIGOLD = "#efa43a";
const GOLD = "#e3a93c";
const GREEN = "#3f7a45";
const WOOD = "#b9773f";
const CLAY = "#c8643b";
const FLAME = "#ffd166";
const BAND = "#f3dfc0";
const CREAM = "#fffaf1";

const line = { stroke: INK, strokeWidth: 5, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
const thin = { stroke: INK, strokeWidth: 3, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

const KURTA =
  "M206 116 L160 128 C150 132 146 140 142 150 L118 226 L150 236 L166 186 L150 380 Q240 398 330 380 L314 186 L330 236 L362 226 L338 150 C334 140 330 132 320 128 L274 116 Q240 156 206 116 Z";

/** A kurta on a wooden hanger, in the 480-wide hero frame. */
function Kurta({ fill, trim, open = false }: { fill: string; trim: string; open?: boolean }) {
  return (
    <g>
      <path d="M240 90 V74 C240 56 262 52 266 66 C269 76 258 82 252 76" fill="none" {...line} />
      <path d="M240 90 L146 128 H334 Z" fill={WOOD} {...line} />
      <path d={KURTA} fill={fill} {...line} strokeDasharray={open ? "14 9" : undefined} />
      <path d="M213 121 Q240 150 267 121" fill="none" stroke={trim} strokeWidth="8" strokeLinecap="round" />
      <path d="M240 146 V222" stroke={trim} strokeWidth="5" strokeLinecap="round" strokeDasharray="1 11" />
      <path d="M156 362 Q240 380 324 362" fill="none" stroke={trim} strokeWidth="11" strokeLinecap="round" />
      <path d="M160 362 Q240 379 320 362" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" strokeDasharray="0 13" />
      <path d="M124 214 L154 224 M356 214 L326 224" stroke={trim} strokeWidth="7" strokeLinecap="round" />
      {[
        [198, 200],
        [282, 200],
        [186, 262],
        [240, 262],
        [294, 262],
        [210, 318],
        [270, 318],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="4.5" fill={trim} />
      ))}
      {open ? <path d="M168 196 L156 360 M312 196 L324 360" stroke={INK} strokeWidth="2.5" strokeDasharray="5 7" strokeLinecap="round" /> : null}
    </g>
  );
}

function Hero() {
  return (
    <svg viewBox="0 0 480 440" role="img" aria-label="A drawing of a rani-pink suit on a hanger with a marigold dupatta, beside a lit diya">
      <ellipse cx="252" cy="410" rx="186" ry="20" fill={BAND} />
      <Kurta fill={RANI} trim={GOLD} />
      {/* the dupatta: over the left shoulder, across the front, over the right and down */}
      <path d="M166 130 C196 196 258 220 318 204 L326 232 C258 252 186 226 150 150 Z" fill={MARIGOLD} {...line} />
      <path d="M160 154 C196 222 258 244 322 226" fill="none" stroke={RANI_DARK} strokeWidth="4" strokeLinecap="round" strokeDasharray="0 12" />
      <path d="M300 124 C320 126 332 136 338 150 L378 380 Q356 396 334 388 L310 178 C306 158 298 144 286 136 Z" fill={MARIGOLD} {...line} />
      <path d="M333 156 L368 372" stroke={RANI} strokeWidth="7" strokeLinecap="round" />
      <path d="M342 392 V410 M356 394 V412 M370 388 V406" {...thin} />
      <circle cx="342" cy="413" r="4.5" fill={RANI} {...thin} />
      <circle cx="356" cy="415" r="4.5" fill={RANI} {...thin} />
      <circle cx="370" cy="409" r="4.5" fill={RANI} {...thin} />
      {/* the diya */}
      <g transform="translate(62 368)">
        <path d="M44 4 C34 -8 38 -24 44 -36 C50 -24 54 -8 44 4 Z" fill={FLAME} {...thin} />
        <path d="M44 -2 C40 -8 41 -15 44 -21 C47 -15 48 -8 44 -2 Z" fill={MARIGOLD} />
        <path d="M4 10 Q44 56 84 10 Q44 22 4 10 Z" fill={CLAY} {...line} />
        <path d="M18 -26 q-8 8 0 16 M70 -26 q8 8 0 16" fill="none" stroke={MARIGOLD} strokeWidth="4" strokeLinecap="round" />
      </g>
      <circle cx="96" cy="112" r="7" fill={RANI} />
      <circle cx="424" cy="96" r="6" fill={MARIGOLD} />
      <circle cx="440" cy="292" r="5" fill={GREEN} />
      <circle cx="70" cy="236" r="5" fill={MARIGOLD} />
      <circle cx="398" cy="40" r="4" fill={GREEN} />
    </svg>
  );
}

function Story() {
  return (
    <svg viewBox="0 0 480 440" role="img" aria-label="A drawing of folded suit fabrics in rani pink, marigold and green, with a marigold flower">
      <ellipse cx="240" cy="404" rx="186" ry="20" fill={BAND} />
      <g transform="translate(0 6)">
        <Fold y={300} fill={GREEN} />
        <Fold y={232} fill={MARIGOLD} x={14} />
        <Fold y={164} fill={RANI} trim={GOLD} />
      </g>
      <g transform="translate(400 112)">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <ellipse key={a} cx="0" cy="-17" rx="11" ry="15" fill={MARIGOLD} {...thin} transform={`rotate(${a})`} />
        ))}
        <circle cx="0" cy="0" r="12" fill="#e07b22" {...thin} />
      </g>
      <circle cx="80" cy="96" r="7" fill={RANI} />
      <circle cx="56" cy="270" r="5" fill={MARIGOLD} />
      <circle cx="440" cy="300" r="5" fill={GREEN} />
    </svg>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <path d="M14 7 L8 9 L3 20 L8 22 L10.5 16 L9.5 35 Q20 37.5 30.5 35 L29.5 16 L32 22 L37 20 L32 9 L26 7 Q20 13 14 7 Z" fill={RANI} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M15 8.5 Q20 13.5 25 8.5" fill="none" stroke={GOLD} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M10.5 31.5 Q20 33.5 29.5 31.5" fill="none" stroke={GOLD} strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

const s = { stroke: INK, strokeWidth: 2.6, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
const SMALL_KURTA = "M18 6 L10 9 L4 22 L10 24 L13 16 L11 42 Q24 45 37 42 L35 16 L38 24 L44 22 L38 9 L30 6 Q24 13 18 6 Z";

const ICONS: Record<string, ReactNode> = {
  unstitched: (
    <g>
      <rect x="7" y="31" width="34" height="10" rx="3" fill={GREEN} {...s} />
      <rect x="9" y="21" width="31" height="11" rx="3" fill={MARIGOLD} {...s} />
      <rect x="5" y="10" width="36" height="12" rx="3" fill={RANI} {...s} />
      <path d="M9 18 H37" stroke={GOLD} strokeWidth="2.6" strokeLinecap="round" />
    </g>
  ),
  semi: (
    <g>
      <path d={SMALL_KURTA} fill={MARIGOLD} {...s} strokeDasharray="4 3" />
      <path d="M19 8 Q24 13 29 8" fill="none" stroke={RANI} strokeWidth="2.4" strokeLinecap="round" />
    </g>
  ),
  stitched: (
    <g>
      <path d={SMALL_KURTA} fill={RANI} {...s} />
      <path d="M19 8 Q24 13 29 8" fill="none" stroke={GOLD} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M12 38.5 Q24 41 36 38.5" fill="none" stroke={GOLD} strokeWidth="2.6" strokeLinecap="round" />
    </g>
  ),
  dupattas: (
    <g>
      <path d="M5 8 H43" {...s} strokeWidth="3" />
      <path d="M8 9 Q24 26 40 9 L40 38 Q32 33 24 39 Q16 33 8 38 Z" fill={GREEN} {...s} />
      <path d="M11 35 Q16 31 24 36 Q32 31 37 35" fill="none" stroke={GOLD} strokeWidth="2.4" />
      <path d="M12 40 v4 M24 41 v4 M36 40 v4" {...s} strokeWidth="2" />
    </g>
  ),
  diya: (
    <g>
      <path d="M24 22 C19 16 21 9 24 4 C27 9 29 16 24 22 Z" fill={FLAME} {...s} />
      <path d="M5 26 Q24 50 43 26 Q24 32 5 26 Z" fill={CLAY} {...s} />
    </g>
  ),
  chat: (
    <g>
      <path d="M8 34 L10 26 A15 15 0 1 1 17 37 Z" fill={CREAM} {...s} />
      <path d="M17 21 h14 M17 27 h9" {...s} />
    </g>
  ),
  tag: (
    <g>
      <path d="M6 24 V8 a2 2 0 0 1 2-2 H24 L42 24 L24 42 Z" fill={MARIGOLD} {...s} />
      <circle cx="15" cy="15" r="3" fill="#fff" {...s} />
    </g>
  ),
  shop: (
    <g>
      <rect x="8" y="20" width="32" height="22" fill={CREAM} {...s} />
      <path d="M6 12 H42 L44 20 H4 Z" fill={RANI} {...s} />
      <path d="M13 12 L11 20 M21 12 L20 20 M27 12 L28 20 M35 12 L37 20" {...s} strokeWidth="1.8" />
      <rect x="20" y="28" width="9" height="14" fill={MARIGOLD} {...s} />
    </g>
  ),
};

function Icon({ id }: { id: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      {ICONS[id] ?? ICONS.stitched}
    </svg>
  );
}

/** One folded length of cloth, its folded end rounded on the left. */
function Fold({ y, fill, trim, x = 0, style }: { y: number; fill: string; trim?: string; x?: number; style?: CSSProperties }) {
  return (
    <g transform={`translate(${x} 0)`} style={style}>
      <path d={`M128 ${y} H356 a14 14 0 0 1 14 14 V${y + 56} a14 14 0 0 1 -14 14 H128 a35 35 0 0 1 0 -70 Z`} fill={fill} {...line} />
      <path d={`M128 ${y + 10} a25 25 0 0 0 0 50`} fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      {trim ? (
        <>
          <path d={`M142 ${y + 52} H362`} stroke={trim} strokeWidth="9" strokeLinecap="round" />
          {[170, 210, 250, 290, 330].map((cx) => (
            <circle key={cx} cx={cx} cy={y + 24} r="5" fill={trim} />
          ))}
        </>
      ) : null}
    </g>
  );
}

const C1 = "var(--c1)";
const C2 = "var(--c2)";

/** Stands in for the shop's photo of a piece, drawn in the piece's own colours. */
function Product({ category }: { category: string }) {
  if (category === "unstitched")
    return (
      <svg viewBox="76 120 370 300" aria-hidden="true">
        <Fold y={330} fill={C2} />
        <Fold y={262} fill={C1} x={12} style={{ filter: "brightness(1.18)" }} />
        <Fold y={194} fill={C1} trim={C2} />
        <path d="M352 210 L388 168" stroke={INK} strokeWidth="3" />
        <path d="M376 150 h40 a6 6 0 0 1 6 6 v34 a6 6 0 0 1 -6 6 h-40 l-14 -23 z" fill={CREAM} {...thin} />
        <circle cx="380" cy="173" r="4" fill={INK} />
      </svg>
    );
  if (category === "dupattas")
    return (
      <svg viewBox="40 40 400 400" aria-hidden="true">
        <path d="M206 104 H314 L330 384 Q268 398 206 386 Z" fill={C1} {...line} style={{ filter: "brightness(0.82)" }} />
        <path d="M212 368 Q268 380 326 366" fill="none" stroke={C2} strokeWidth="11" strokeLinecap="round" />
        <path d="M110 98 H390" {...line} strokeWidth="9" />
        <circle cx="104" cy="98" r="10" fill={WOOD} {...thin} />
        <circle cx="396" cy="98" r="10" fill={WOOD} {...thin} />
        <path d="M192 96 H306 L298 318 Q246 330 190 318 Z" fill={C1} {...line} />
        <path d="M186 86 Q250 72 312 86 L310 108 Q250 96 188 108 Z" fill={C1} {...line} />
        <path d="M196 300 Q246 312 294 300" fill="none" stroke={C2} strokeWidth="12" strokeLinecap="round" />
        <path d="M226 120 L222 290 M264 120 L266 292" stroke={INK} strokeWidth="2.5" strokeLinecap="round" opacity="0.45" />
        {[
          [210, 150], [246, 140], [282, 150], [208, 200], [246, 190], [282, 200], [210, 250], [246, 240], [280, 250],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="5" fill={C2} />
        ))}
        <path d="M204 322 v20 M228 326 v20 M252 328 v20 M276 326 v20 M292 322 v20" {...thin} />
        {[204, 228, 252, 276, 292].map((x, i) => (
          <circle key={x} cx={x} cy={i === 0 || i === 4 ? 346 : 350} r="5" fill={C2} {...thin} />
        ))}
        <path d="M312 390 v18 M326 388 v18" {...thin} />
        <circle cx="312" cy="412" r="5" fill={C2} {...thin} />
        <circle cx="326" cy="410" r="5" fill={C2} {...thin} />
      </svg>
    );
  return (
    <svg viewBox="40 40 400 380" aria-hidden="true">
      <Kurta fill={C1} trim={C2} open={category === "semi"} />
    </svg>
  );
}

/** Gold trim on most fabrics; rani on yellows, where gold would vanish. */
function trimFor(swatch: string): string {
  const n = Number.parseInt(swatch.slice(1) || "0", 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  return r > 190 && g > 140 && b < 130 ? RANI_DARK : GOLD;
}

export const art: Art = { Logo, Hero, Story, Icon, Product, trimFor };
