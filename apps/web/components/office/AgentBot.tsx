// Stand-in characters for the office until its own arrive: one small figure per agent, a mark given eyes and feet,
// drawn on a 96 × 112 box. Plain SVG with SMIL motion (bob, blink); reduced motion is the office's to apply.
import type { ReactElement } from "react";
import type { AgentId } from "./types";

const INK = "#201a13";
const PAPER = "#fffdf9";
const CHEEK = "#f2704f";

const FIGURE: Record<AgentId, ReactElement> = {
  munshi: (
    <>
      <ellipse cx="48" cy="104" rx="20" ry="4" fill={INK} opacity="0.12" />
      <g>
      <animateTransform attributeName="transform" type="translate" values="0 0; 0 -5; 0 0" dur="3s" repeatCount="indefinite" />
      <g transform="rotate(-18 48 46)">
      <ellipse cx="48" cy="46" rx="40" ry="11" fill="none" stroke={INK} strokeWidth="2" />
      </g>
      <circle cx="48" cy="46" r="21" fill={INK} />
      <g transform="rotate(-18 48 46)">
      <circle cx="0" cy="0" r="3.4" fill={INK}>
      <animateMotion dur="6s" repeatCount="indefinite" path="M88 46 A40 11 0 1 1 8 46 A40 11 0 1 1 88 46" />
      </circle>
      </g>
      <ellipse cx="41" cy="43" rx="3" ry="4" fill={PAPER}><animate attributeName="ry" values="4;4;0.5;4" keyTimes="0;0.9;0.95;1" dur="4.2s" repeatCount="indefinite" /></ellipse>
      <ellipse cx="55" cy="43" rx="3" ry="4" fill={PAPER}><animate attributeName="ry" values="4;4;0.5;4" keyTimes="0;0.9;0.95;1" dur="4.2s" repeatCount="indefinite" /></ellipse>
      <circle cx="36" cy="52" r="2.6" fill={CHEEK} opacity="0.9" />
      <circle cx="60" cy="52" r="2.6" fill={CHEEK} opacity="0.9" />
      </g>
    </>
  ),
  tally: (
    <>
      <ellipse cx="48" cy="104" rx="22" ry="4.5" fill={INK} opacity="0.12" />
      <rect x="34" y="82" width="10" height="10" rx="4" fill={INK} />
      <rect x="52" y="82" width="10" height="10" rx="4" fill={INK} />
      <g>
      <animateTransform attributeName="transform" type="translate" values="0 0; 0 -2.5; 0 0" dur="1.7s" repeatCount="indefinite" />
      <g transform="translate(-2 -2.5)">
      <path d="M48 16 A30 30 0 0 0 48 76 Z" fill={INK} />
      <path d="M48 23.5 A22.5 22.5 0 0 0 48 68.5 Z" fill={PAPER} />
      <path d="M48 31 A15 15 0 0 0 48 61 Z" fill={INK} />
      </g>
      <g transform="translate(2 0)">
      <path d="M48 16 A30 30 0 0 1 48 76 Z" fill={INK} />
      <path d="M48 23.5 A22.5 22.5 0 0 1 48 68.5 Z" fill={PAPER} />
      <path d="M48 31 A15 15 0 0 1 48 61 Z" fill={INK} />
      </g>
      <ellipse cx="42" cy="44" rx="2.6" ry="3.4" fill={PAPER}><animate attributeName="ry" values="3.4;3.4;0.4;3.4" keyTimes="0;0.9;0.95;1" dur="3.6s" repeatCount="indefinite" /></ellipse>
      <ellipse cx="54" cy="46" rx="2.6" ry="3.4" fill={PAPER}><animate attributeName="ry" values="3.4;3.4;0.4;3.4" keyTimes="0;0.9;0.95;1" dur="3.6s" repeatCount="indefinite" /></ellipse>
      </g>
    </>
  ),
  ledger: (
    <>
      <ellipse cx="48" cy="104" rx="22" ry="4.5" fill={INK} opacity="0.12" />
      <rect x="34" y="82" width="10" height="10" rx="4" fill={INK} />
      <rect x="52" y="82" width="10" height="10" rx="4" fill={INK} />
      <g>
      <animateTransform attributeName="transform" type="translate" values="0 0; 0 -2.5; 0 0" dur="2s" repeatCount="indefinite" />
      <circle cx="48" cy="46" r="30" fill={INK} />
      <rect x="16" y="57" width="64" height="3" fill={PAPER} />
      <rect x="18" y="64" width="60" height="3" fill={PAPER} />
      <rect x="30" y="18" width="2" height="34" fill={CHEEK} opacity="0.9">
      <animate attributeName="x" values="26;68;26" dur="5s" repeatCount="indefinite" />
      </rect>
      <ellipse cx="40" cy="38" rx="3" ry="4" fill={PAPER}><animate attributeName="ry" values="4;4;0.5;4" keyTimes="0;0.9;0.95;1" dur="5s" repeatCount="indefinite" /></ellipse>
      <ellipse cx="56" cy="38" rx="3" ry="4" fill={PAPER}><animate attributeName="ry" values="4;4;0.5;4" keyTimes="0;0.9;0.95;1" dur="5s" repeatCount="indefinite" /></ellipse>
      </g>
    </>
  ),
  dash: (
    <>
      <ellipse cx="48" cy="104" rx="22" ry="4.5" fill={INK} opacity="0.12" />
      <rect x="34" y="82" width="10" height="10" rx="4" fill={INK} />
      <rect x="52" y="82" width="10" height="10" rx="4" fill={INK} />
      <g>
      <animateTransform attributeName="transform" type="translate" values="0 0; 0 -3; 0 0" dur="1.2s" repeatCount="indefinite" />
      <g transform="translate(-2 2)">
      <path d="M69.2 67.2 A30 30 0 0 1 26.8 24.8 Z" fill={INK} />
      </g>
      <g transform="translate(3 -3)">
      <animateTransform attributeName="transform" type="translate" values="3 -3; 6 -6; 3 -3" dur="2.4s" repeatCount="indefinite" />
      <path d="M26.8 24.8 A30 30 0 0 1 69.2 67.2 Z" fill={INK} />
      <ellipse cx="51" cy="39" rx="3" ry="4" fill={PAPER}><animate attributeName="ry" values="4;4;0.5;4" keyTimes="0;0.9;0.95;1" dur="3.2s" repeatCount="indefinite" /></ellipse>
      <ellipse cx="62" cy="46" rx="3" ry="4" fill={PAPER}><animate attributeName="ry" values="4;4;0.5;4" keyTimes="0;0.9;0.95;1" dur="3.2s" repeatCount="indefinite" /></ellipse>
      </g>
      </g>
    </>
  ),
  echo: (
    <>
      <ellipse cx="48" cy="104" rx="22" ry="4.5" fill={INK} opacity="0.12" />
      <rect x="34" y="82" width="10" height="10" rx="4" fill={INK} />
      <rect x="52" y="82" width="10" height="10" rx="4" fill={INK} />
      <g>
      <animateTransform attributeName="transform" type="translate" values="0 0; 0 -2.5; 0 0" dur="2.2s" repeatCount="indefinite" />
      <circle cx="48" cy="46" r="25" fill="none" stroke={INK} strokeWidth="2" opacity="0.55" />
      <circle cx="48" cy="46" r="33" fill="none" stroke={INK} strokeWidth="1.6" opacity="0.25" />
      <circle cx="48" cy="46" r="18" fill="none" stroke={INK} strokeWidth="1.6">
      <animate attributeName="r" values="18;40" dur="2.4s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="0.8;0" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <circle cx="48" cy="46" r="18" fill={INK} />
      <ellipse cx="42" cy="44" rx="2.8" ry="3.8" fill={PAPER}><animate attributeName="ry" values="3.8;3.8;0.4;3.8" keyTimes="0;0.9;0.95;1" dur="4.6s" repeatCount="indefinite" /></ellipse>
      <ellipse cx="54" cy="44" rx="2.8" ry="3.8" fill={PAPER}><animate attributeName="ry" values="3.8;3.8;0.4;3.8" keyTimes="0;0.9;0.95;1" dur="4.6s" repeatCount="indefinite" /></ellipse>
      <circle cx="37.5" cy="51" r="2.2" fill={CHEEK} opacity="0.9" />
      <circle cx="58.5" cy="51" r="2.2" fill={CHEEK} opacity="0.9" />
      </g>
    </>
  ),
  bloom: (
    <>
      <ellipse cx="48" cy="104" rx="22" ry="4.5" fill={INK} opacity="0.12" />
      <rect x="36" y="82" width="9" height="9" rx="4" fill={INK} />
      <rect x="51" y="82" width="9" height="9" rx="4" fill={INK} />
      <g>
      <animateTransform attributeName="transform" type="translate" values="0 0; 0 -2.5; 0 0" dur="2.6s" repeatCount="indefinite" />
      <circle cx="65" cy="30.7" r="2.6" fill={INK}><animate attributeName="opacity" values="1;0.25;1" dur="3.1s" repeatCount="indefinite" /></circle>
      <circle cx="27.6" cy="29" r="2.2" fill={INK} opacity="0.8" />
      <circle cx="71.8" cy="56.2" r="2.6" fill={INK} opacity="0.85" />
      <circle cx="48" cy="71.5" r="2.3" fill={INK} opacity="0.8"><animate attributeName="opacity" values="0.8;0.2;0.8" dur="2.3s" repeatCount="indefinite" /></circle>
      <circle cx="20.8" cy="47.7" r="2.3" fill={INK} opacity="0.7" />
      <circle cx="75.2" cy="42.6" r="2" fill={INK} opacity="0.65"><animate attributeName="opacity" values="0.65;0.1;0.65" dur="2.8s" repeatCount="indefinite" /></circle>
      <circle cx="58.2" cy="17.1" r="1.9" fill={INK} opacity="0.55" />
      <circle cx="23.8" cy="69.8" r="1.9" fill={INK} opacity="0.5"><animate attributeName="opacity" values="0.5;0.05;0.5" dur="3.6s" repeatCount="indefinite" /></circle>
      <circle cx="13" cy="35.8" r="1.5" fill={INK} opacity="0.4" />
      <circle cx="82" cy="66.4" r="1.6" fill={INK} opacity="0.4" />
      <circle cx="41.2" cy="12" r="1.4" fill={INK} opacity="0.35"><animate attributeName="opacity" values="0.35;0;0.35" dur="2.1s" repeatCount="indefinite" /></circle>
      <circle cx="85.4" cy="25.6" r="1.2" fill={INK} opacity="0.3" />
      <circle cx="10.6" cy="59.6" r="1.2" fill={INK} opacity="0.3" />
      <circle cx="44.6" cy="29" r="3" fill={INK} />
      <circle cx="30.6" cy="56.2" r="3" fill={INK} opacity="0.9" />
      <circle cx="48" cy="46" r="16" fill={INK} />
      <ellipse cx="42.5" cy="44" rx="2.6" ry="3.6" fill={PAPER}><animate attributeName="ry" values="3.6;3.6;0.4;3.6" keyTimes="0;0.9;0.95;1" dur="3.9s" repeatCount="indefinite" /></ellipse>
      <ellipse cx="53.5" cy="44" rx="2.6" ry="3.6" fill={PAPER}><animate attributeName="ry" values="3.6;3.6;0.4;3.6" keyTimes="0;0.9;0.95;1" dur="3.9s" repeatCount="indefinite" /></ellipse>
      <circle cx="38.5" cy="50.5" r="2" fill={CHEEK} opacity="0.9" />
      <circle cx="57.5" cy="50.5" r="2" fill={CHEEK} opacity="0.9" />
      </g>
    </>
  ),
  keeper: (
    <>
      <ellipse cx="48" cy="104" rx="22" ry="4.5" fill={INK} opacity="0.12" />
      <rect x="34" y="82" width="10" height="10" rx="4" fill={INK} />
      <rect x="52" y="82" width="10" height="10" rx="4" fill={INK} />
      <g>
      <animateTransform attributeName="transform" type="translate" values="0 0; 0 -2; 0 0" dur="2.8s" repeatCount="indefinite" />
      <circle cx="48" cy="46" r="30" fill={INK} />
      <rect x="15" y="31" width="8" height="30" rx="2" fill={PAPER}><animate attributeName="x" values="15;18;15" dur="5s" repeatCount="indefinite" /></rect>
      <rect x="73" y="31" width="8" height="30" rx="2" fill={PAPER}><animate attributeName="x" values="73;70;73" dur="5s" repeatCount="indefinite" /></rect>
      <ellipse cx="41" cy="42" rx="3" ry="4" fill={PAPER}><animate attributeName="ry" values="4;4;0.5;4" keyTimes="0;0.9;0.95;1" dur="5.4s" repeatCount="indefinite" /></ellipse>
      <ellipse cx="55" cy="42" rx="3" ry="4" fill={PAPER}><animate attributeName="ry" values="4;4;0.5;4" keyTimes="0;0.9;0.95;1" dur="5.4s" repeatCount="indefinite" /></ellipse>
      <circle cx="36" cy="51" r="2.4" fill={CHEEK} opacity="0.9" />
      <circle cx="60" cy="51" r="2.4" fill={CHEEK} opacity="0.9" />
      </g>
    </>
  ),
};

export function AgentBot({ id, size }: { id: AgentId; size: number }) {
  return (
    <svg viewBox="0 0 96 112" width={size} height={(size * 112) / 96} aria-hidden="true">
      {FIGURE[id]}
    </svg>
  );
}
