// The seven agents as figures, in six styles: people at their desks, clockwork automatons, and the cast's own marks
// drawn in clay, brass, folded paper or glass. Each figure is drawn on a 64 × 66 box around its feet.
import { useId } from "react";
import type { AgentStyleId } from "./presets";
import type { AgentId, AgentState } from "./types";

function CharacterFeet({ walking, agentStyle }: { walking: boolean; agentStyle: AgentStyleId }) {
  const fill = agentStyle === "brass" ? "var(--amber)" : "var(--ink)";
  const rx = agentStyle === "origami" ? 0.8 : 2.8;
  return (
    <g className={walking ? "munshi-feet-walk" : ""}>
      <rect x="-10" y="12" width="7.2" height="5.8" rx={rx} fill={fill} />
      <rect x="2.8" y="12" width="7.2" height="5.8" rx={rx} fill={fill} />
    </g>
  );
}

function CharacterEyes({
  xOffset = 0,
  yOffset = -2,
  blush = true,
  sleeping = false,
  agentStyle,
}: {
  xOffset?: number;
  yOffset?: number;
  blush?: boolean;
  sleeping?: boolean;
  agentStyle: AgentStyleId;
}) {
  return (
    <g transform={`translate(${xOffset}, ${yOffset})`} className="munshi-eyes">
      {sleeping ? (
        <>
          <path d="M -7.5 0 Q -5.5 2 -3.5 0" stroke="var(--card)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          <path d="M 3.5 0 Q 5.5 2 7.5 0" stroke="var(--card)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        </>
      ) : (
        <g className="munshi-blink">
          {agentStyle === "brass" ? (
            <>
              <polygon points="-5.2,-2.3 -3.2,0 -5.2,2.3 -7.2,0" fill="var(--card)" />
              <polygon points="5.2,-2.3 7.2,0 5.2,2.3 3.2,0" fill="var(--card)" />
            </>
          ) : (
            <>
              <circle cx="-5.2" cy="0" r="2" fill="var(--card)" />
              <circle cx="5.2" cy="0" r="2" fill="var(--card)" />
            </>
          )}
        </g>
      )}
      {blush && (
        <>
          <ellipse cx="-8.2" cy="3.1" rx="2.2" ry="1.1" fill="var(--coral)" opacity="0.7" />
          <ellipse cx="8.2" cy="3.1" rx="2.2" ry="1.1" fill="var(--coral)" opacity="0.7" />
        </>
      )}
    </g>
  );
}

function StyleCrownOrnament({ agentStyle }: { agentStyle: AgentStyleId }) {
  if (agentStyle === "brass") {
    return (
      <g transform="translate(0, -17)">
        <polygon points="0,-6 3.5,0 -3.5,0" fill="var(--coral)" />
        <circle cx="0" cy="-7" r="1.6" fill="var(--amber)" />
      </g>
    );
  }
  if (agentStyle === "origami") {
    return <line x1="-9" y1="-12" x2="9" y2="9" stroke="var(--coral)" strokeWidth="0.9" strokeDasharray="2 2" opacity="0.7" />;
  }
  if (agentStyle === "glass") {
    return <circle cx="0" cy="-2" r="16.2" fill="none" stroke="var(--teal)" strokeWidth="1.1" strokeDasharray="3 3" opacity="0.65" />;
  }
  return null;
}

// What the agent is doing, drawn over the figure: a page while drafting, a carried draft while walking or waiting,
// dots while thinking, a tick when done, a pause when blocked. The waiting badge shows a count only when one is given.
function StateOverlays({ state, waitingCount }: { state: AgentState; waitingCount?: number | undefined }) {
  return (
    <g>
      {state === "drafting" && (
        <g transform="translate(18, -8)">
          <rect x="0" y="0" width="15" height="19" rx="2.5" fill="var(--card)" stroke="var(--edge)" strokeWidth="1.2" />
          <line x1="3" y1="5" x2="12" y2="5" stroke="var(--coral)" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="3" y1="9.5" x2="11" y2="9.5" stroke="var(--edge)" strokeWidth="1.3" strokeLinecap="round" />
          <line x1="3" y1="13.5" x2="9" y2="13.5" stroke="var(--edge)" strokeWidth="1.3" strokeLinecap="round" />
        </g>
      )}
      {(state === "walking" || state === "waiting") && (
        <g transform="translate(13, -3) rotate(8)">
          <rect x="0" y="0" width="13" height="16" rx="2" fill="var(--card)" stroke="var(--coral)" strokeWidth="1.2" />
          <line x1="2.5" y1="4.5" x2="10" y2="4.5" stroke="var(--coral)" strokeWidth="1.5" />
          <line x1="2.5" y1="8.5" x2="9" y2="8.5" stroke="var(--edge)" strokeWidth="1.2" />
        </g>
      )}
      {state === "waiting" && waitingCount !== undefined && waitingCount > 0 && (
        <g transform="translate(18, -22)">
          <rect x="-8" y="-8" width="16" height="15" rx="7.5" fill="var(--coral)" />
          <text x="0" y="3" textAnchor="middle" fill="#FFFDF9" fontSize="9.5" fontFamily="var(--font-mono, monospace)" fontWeight="700">
            {waitingCount}
          </text>
        </g>
      )}
      {state === "thinking" && (
        <g transform="translate(0, -34)">
          <rect x="-15" y="-8" width="30" height="15" rx="7.5" fill="var(--amber-wash)" stroke="var(--amber)" strokeWidth="1.1" />
          <circle cx="-6.5" cy="-0.5" r="2" fill="var(--amber)" className="munshi-dot-1" />
          <circle cx="0" cy="-0.5" r="2" fill="var(--amber)" className="munshi-dot-2" />
          <circle cx="6.5" cy="-0.5" r="2" fill="var(--amber)" className="munshi-dot-3" />
        </g>
      )}
      {state === "done" && (
        <g transform="translate(0, -34)" className="munshi-pop">
          <circle cx="0" cy="0" r="9.5" fill="var(--ok)" />
          <path d="M -4 0.3 L -1.2 3.2 L 4.5 -2.8" fill="none" stroke="#FFFDF9" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      {state === "blocked" && (
        <g transform="translate(15, -21)">
          <circle cx="0" cy="0" r="8" fill="var(--wall-r)" stroke="var(--ink)" strokeWidth="1.2" />
          <rect x="-2.8" y="-3.2" width="1.9" height="6.4" rx="0.8" fill="var(--ink)" />
          <rect x="0.9" y="-3.2" width="1.9" height="6.4" rx="0.8" fill="var(--ink)" />
        </g>
      )}
    </g>
  );
}

type Accessory = "spectacles" | "loupe" | "visor" | "satchel" | "headset" | "gajra" | "keys";
const PEOPLE: Record<AgentId, { skin: string; hair: string; kurta: string; jacket: string; stole: string; accessory: Accessory }> = {
  munshi: { skin: "#D99B72", hair: "#2B2420", kurta: "#FFFDF9", jacket: "#3A281E", stole: "#F2704F", accessory: "spectacles" },
  tally: { skin: "#C8875E", hair: "#1E1916", kurta: "#DCEFEA", jacket: "#0E5E57", stole: "#F5E1B8", accessory: "loupe" },
  ledger: { skin: "#E0A67E", hair: "#241D19", kurta: "#FBF6EA", jacket: "#7A4E0E", stole: "#D94E34", accessory: "visor" },
  dash: { skin: "#C98A63", hair: "#1A1512", kurta: "#F2704F", jacket: "#201A13", stole: "#F5E1B8", accessory: "satchel" },
  echo: { skin: "#D5986F", hair: "#1C1614", kurta: "#E8F4F1", jacket: "#145A52", stole: "#F2704F", accessory: "headset" },
  bloom: { skin: "#DEA178", hair: "#221A17", kurta: "#FCE4AE", jacket: "#A33A20", stole: "#F2704F", accessory: "gajra" },
  keeper: { skin: "#BE7E56", hair: "#3E3732", kurta: "#EFE5D3", jacket: "#2B1612", stole: "#8C580C", accessory: "keys" },
};

/** A shop's staff as small figurines: each agent in their own kurta, waistcoat and stole, with the thing they work with. */
function PersonFigure({ id, state, closingSlots }: { id: AgentId; state: AgentState; closingSlots: boolean }) {
  const walking = state === "walking";
  const p = PEOPLE[id];
  return (
    <g className={walking ? "munshi-walk-bob" : id === "munshi" ? "munshi-float" : ""}>
      <g className={walking ? "munshi-feet-walk" : ""}>
        <rect x="-7.5" y="7" width="5" height="9" rx="2.2" fill="#2B211B" />
        <rect x="2.5" y="7" width="5" height="9" rx="2.2" fill="#2B211B" />
        <ellipse cx="-5" cy="16" rx="4.2" ry="2.2" fill="#6E3B22" />
        <ellipse cx="5" cy="16" rx="4.2" ry="2.2" fill="#6E3B22" />
      </g>
      <path d="M -11 -7 C -12 -1, -12 8, -9 11 L 9 11 C 12 8, 12 -1, 11 -7 Z" fill={p.kurta} stroke="var(--ink)" strokeWidth="0.9" />
      <path d="M -10.5 -7 C -11 -1, -10.5 7, -8.5 10 L -2 10 L -2 -7 Z" fill={p.jacket} />
      <path d="M 10.5 -7 C 11 -1, 10.5 7, 8.5 10 L 2 10 L 2 -7 Z" fill={p.jacket} />
      <path d="M -8 -7 Q 0 1 9 -5 L 7 7 Q 0 3 -7 6 Z" fill={p.stole} opacity="0.9" />
      <path d="M -11 -6 Q -15 1 -11 6" stroke={p.kurta} strokeWidth="4.2" strokeLinecap="round" fill="none" />
      <circle cx="-11" cy="6.5" r="2.3" fill={p.skin} />
      <path d="M 11 -6 Q 15 1 11 6" stroke={p.kurta} strokeWidth="4.2" strokeLinecap="round" fill="none" />
      <circle cx="11" cy="6.5" r="2.3" fill={p.skin} />
      <rect x="-3" y="-11" width="6" height="5" rx="2" fill={p.skin} />
      <circle cx="0" cy="-17" r="9.5" fill={p.skin} stroke="var(--ink)" strokeWidth="0.8" />
      <ellipse cx="-5.5" cy="-15" rx="2.1" ry="1.1" fill="#D95B43" opacity="0.45" />
      <ellipse cx="5.5" cy="-15" rx="2.1" ry="1.1" fill="#D95B43" opacity="0.45" />
      <path d="M -9.8 -18 C -10 -26, 10 -26, 9.8 -18 C 7 -22, -7 -22, -9.8 -18 Z" fill={p.hair} />
      {id === "munshi" && <path d="M -9.5 -21 Q 0 -28 9.5 -21 L 8 -18 Q 0 -22 -8 -18 Z" fill={p.stole} stroke="var(--ink)" strokeWidth="0.8" />}
      {id === "bloom" && (
        <g transform="translate(0, -26)">
          <circle cx="0" cy="0" r="4.5" fill={p.hair} />
          <circle cx="-3.5" cy="1" r="1.4" fill="#FFFDF9" />
          <circle cx="0" cy="1.8" r="1.4" fill="#FFFDF9" />
          <circle cx="3.5" cy="1" r="1.4" fill="#FFFDF9" />
        </g>
      )}
      <g className="munshi-blink">
        <path d="M -6 -19.5 Q -4 -20.5 -2 -19.5" stroke={p.hair} strokeWidth="1.1" fill="none" strokeLinecap="round" />
        <path d="M 2 -19.5 Q 4 -20.5 6 -19.5" stroke={p.hair} strokeWidth="1.1" fill="none" strokeLinecap="round" />
        {state === "idle" && id === "bloom" ? (
          <>
            <path d="M -6 -17 Q -4 -15.5 -2 -17" stroke="#201A13" strokeWidth="1.3" fill="none" />
            <path d="M 2 -17 Q 4 -15.5 6 -17" stroke="#201A13" strokeWidth="1.3" fill="none" />
          </>
        ) : (
          <>
            <circle cx="-4" cy="-17" r="1.4" fill="#201A13" />
            <circle cx="4" cy="-17" r="1.4" fill="#201A13" />
            <circle cx="-4.4" cy="-17.4" r="0.5" fill="#FFFDF9" />
            <circle cx="3.6" cy="-17.4" r="0.5" fill="#FFFDF9" />
          </>
        )}
      </g>
      {p.accessory === "spectacles" && (
        <g stroke="#B8860B" strokeWidth="1.1" fill="rgba(255,255,255,0.2)">
          <circle cx="-4" cy="-17" r="2.8" />
          <circle cx="4" cy="-17" r="2.8" />
          <line x1="-1.2" y1="-17" x2="1.2" y2="-17" />
        </g>
      )}
      {p.accessory === "loupe" && (
        <g>
          <circle cx="-4" cy="-17" r="3.2" fill="rgba(220,239,234,0.45)" stroke="var(--coral)" strokeWidth="1.4" />
          <rect x="6" y="1" width="7" height="9" rx="1" fill="#FFFDF9" stroke="var(--ink)" strokeWidth="0.9" />
        </g>
      )}
      {p.accessory === "visor" && (
        <g>
          <path d="M -9 -20 Q 0 -23 9 -20 L 10 -18 Q 0 -20 -10 -18 Z" fill="#0E5E57" opacity="0.85" />
          <rect x="-13" y="-2" width="8" height="10" rx="1.2" fill="#A33A20" stroke="#F5E1B8" strokeWidth="0.8" />
        </g>
      )}
      {p.accessory === "satchel" && (
        <g>
          <line x1="-8" y1="-7" x2="9" y2="8" stroke="#7A4E0E" strokeWidth="2.2" />
          <rect x="5" y="3" width="8" height="7" rx="1.5" fill="#8C580C" stroke="#201A13" strokeWidth="0.8" />
        </g>
      )}
      {p.accessory === "headset" && (
        <g>
          <path d="M -9.5 -17 A 9.5 9.5 0 0 1 9.5 -17" fill="none" stroke="var(--coral)" strokeWidth="1.8" />
          <circle cx="-9.8" cy="-16.5" r="2.4" fill="var(--ink)" />
          <circle cx="9.8" cy="-16.5" r="2.4" fill="var(--ink)" />
          <path d="M 9.5 -16 Q 6 -12 2 -13" fill="none" stroke="var(--ink)" strokeWidth="1.1" />
        </g>
      )}
      {p.accessory === "keys" && (
        <g transform={`translate(-11, 6) ${closingSlots ? "rotate(25)" : ""}`}>
          <circle cx="0" cy="0" r="2.8" fill="none" stroke="#D4AF37" strokeWidth="1.2" />
          <line x1="0" y1="2.8" x2="0" y2="7.5" stroke="#D4AF37" strokeWidth="1.2" />
        </g>
      )}
      {id === "munshi" && (
        <g className={state === "thinking" ? "munshi-moon-fast" : "munshi-moon-slow"}>
          <circle cx="18" cy="-18" r="2.6" fill="var(--coral)" />
        </g>
      )}
    </g>
  );
}

/** A clockwork figure: a brass chassis, a porcelain head, a heart that glows coral while the agent works. */
function AutomatonFigure({ id, state }: { id: AgentId; state: AgentState }) {
  const walking = state === "walking";
  const working = state === "thinking" || state === "drafting" || state === "watching";
  return (
    <g className={walking ? "munshi-walk-bob" : id === "munshi" ? "munshi-float" : ""}>
      <CharacterFeet walking={walking} agentStyle="brass" />
      <rect x="-11" y="-6" width="22" height="17" rx="5" fill="#C89D54" stroke="var(--ink)" strokeWidth="1.2" />
      <rect x="-7.5" y="-3" width="15" height="10" rx="2.5" fill="#201A13" />
      <circle cx="0" cy="2" r="3.5" fill={working ? "var(--coral)" : "var(--teal)"} className={working ? "echo-ring-outer" : ""} />
      <rect x="-9.5" y="-23" width="19" height="15" rx="6" fill="#FFFDF9" stroke="var(--ink)" strokeWidth="1.2" />
      <line x1="0" y1="-23" x2="0" y2="-28" stroke="var(--coral)" strokeWidth="1.8" />
      <circle cx="0" cy="-29" r="2.4" fill="var(--amber)" />
      <rect x="-6.5" y="-18" width="13" height="5" rx="2.5" fill="#201A13" />
      <circle cx="-3.5" cy="-15.5" r="1.5" fill="var(--coral)" />
      <circle cx="3.5" cy="-15.5" r="1.5" fill="var(--coral)" />
    </g>
  );
}

// The cast's own marks (clay, brass, folded paper, glass): Munshi's orbit, Tally's split halves, Ledger's ruled lines,
// Dash's slanted cut, Echo's rings, Bloom's drifting dots, Keeper's vault slots.
function MarkFigure({ id, state, agentStyle, closingSlots, clip }: { id: AgentId; state: AgentState; agentStyle: AgentStyleId; closingSlots: boolean; clip: string }) {
  const blocked = state === "blocked";
  const walking = state === "walking";
  const bodyOpacity = agentStyle === "glass" ? 0.84 : 1;
  const active = state === "thinking" || state === "watching" || state === "drafting";
  if (id === "munshi") {
    return (
      <g className={blocked ? "" : "munshi-float"}>
        <StyleCrownOrnament agentStyle={agentStyle} />
        <path d="M -23 3 A 24 8.5 -16 0 1 23 -4" fill="none" stroke="var(--edge)" strokeWidth="1.7" opacity="0.75" />
        {agentStyle === "origami" ? (
          <polygon points="0,-17 14,-8 14,6 0,13 -14,6 -14,-8" fill="var(--ink)" />
        ) : (
          <circle cx="0" cy="-2" r="14.8" fill="var(--ink)" opacity={bodyOpacity} />
        )}
        <ellipse cx="-4.8" cy="-7.5" rx="5.5" ry="3.2" transform="rotate(-25 -4.8 -7.5)" fill="var(--card)" opacity="0.18" />
        <CharacterEyes yOffset={-2.5} agentStyle={agentStyle} />
        <path d="M 23 -4 A 24 8.5 -16 0 1 -23 3" fill="none" stroke="var(--coral)" strokeWidth="1.9" />
        <g className={state === "thinking" ? "munshi-moon-fast" : "munshi-moon-slow"}>
          <circle cx="20.5" cy="-3.5" r="3.6" fill="var(--coral)" />
          <circle cx="-19" cy="2.5" r="2.1" fill="var(--teal)" />
        </g>
      </g>
    );
  }
  if (id === "tally") {
    return (
      <>
        <defs>
          <clipPath id={`${clip}-l`}>
            <rect x="-24" y="-28" width="24" height="52" />
          </clipPath>
          <clipPath id={`${clip}-r`}>
            <rect x="0" y="-28" width="24" height="52" />
          </clipPath>
        </defs>
        <CharacterFeet walking={walking} agentStyle={agentStyle} />
        <g className={walking ? "munshi-walk-bob" : ""}>
          <StyleCrownOrnament agentStyle={agentStyle} />
          {(["l", "r"] as const).map((side) => (
            <g
              key={side}
              clipPath={`url(#${clip}-${side})`}
              transform={side === "l" ? "translate(0, -3.5)" : undefined}
              className={active ? (side === "l" ? "tally-shift-l" : "tally-shift-r") : ""}
            >
              <circle cx="0" cy="-1" r="14.5" fill="var(--ink)" opacity={bodyOpacity} />
              <circle cx="0" cy="-1" r="10.2" fill="none" stroke="var(--card)" strokeWidth="1.3" opacity="0.32" />
              <circle cx="0" cy="-1" r="6.2" fill="none" stroke="var(--coral)" strokeWidth="1.4" opacity="0.8" />
            </g>
          ))}
          <CharacterEyes yOffset={-2.5} blush={false} agentStyle={agentStyle} />
        </g>
      </>
    );
  }
  if (id === "ledger") {
    return (
      <>
        <CharacterFeet walking={walking} agentStyle={agentStyle} />
        <g className={walking ? "munshi-walk-bob" : ""}>
          <StyleCrownOrnament agentStyle={agentStyle} />
          <circle cx="0" cy="-2" r="14.8" fill="var(--ink)" opacity={bodyOpacity} />
          <line x1="-11" y1="-8" x2="11" y2="-8" stroke="var(--card)" strokeWidth="1.3" opacity="0.32" strokeLinecap="round" />
          <line x1="-12.5" y1="-2" x2="12.5" y2="-2" stroke="var(--card)" strokeWidth="1.3" opacity="0.32" strokeLinecap="round" />
          <line x1="-11" y1="4" x2="11" y2="4" stroke="var(--card)" strokeWidth="1.3" opacity="0.32" strokeLinecap="round" />
          <circle cx="-6" cy="-8" r="1.7" fill="var(--amber)" />
          <circle cx="5" cy="4" r="1.7" fill="var(--coral)" />
          <line x1="-11.5" y1="-2" x2="11.5" y2="-2" stroke="var(--coral)" strokeWidth="1.9" strokeLinecap="round" className={active ? "ledger-sweep" : ""} />
          <CharacterEyes yOffset={-3} agentStyle={agentStyle} />
        </g>
      </>
    );
  }
  if (id === "dash") {
    return (
      <>
        <defs>
          <clipPath id={`${clip}-u`}>
            <polygon points="-25,-28 25,-28 25,-6 -25,10" />
          </clipPath>
          <clipPath id={`${clip}-d`}>
            <polygon points="-25,10 25,-6 25,25 -25,25" />
          </clipPath>
        </defs>
        <CharacterFeet walking={walking} agentStyle={agentStyle} />
        <g className={walking ? "dash-hop-bob" : ""}>
          <StyleCrownOrnament agentStyle={agentStyle} />
          <g clipPath={`url(#${clip}-d)`}>
            <circle cx="0" cy="-2" r="14.5" fill="var(--ink)" opacity={bodyOpacity} />
          </g>
          <line x1="-14" y1="5.5" x2="15" y2="-3.5" stroke="var(--coral)" strokeWidth="2.2" strokeLinecap="round" />
          <g clipPath={`url(#${clip}-u)`} transform="translate(3.5, -2.4)">
            <circle cx="0" cy="-2" r="14.5" fill="var(--ink)" opacity={bodyOpacity} />
          </g>
          <CharacterEyes xOffset={2} yOffset={-5} agentStyle={agentStyle} />
        </g>
      </>
    );
  }
  if (id === "echo") {
    const pulsing = state === "watching" || state === "thinking" || state === "drafting";
    return (
      <>
        <CharacterFeet walking={walking} agentStyle={agentStyle} />
        <g className={`${walking ? "munshi-walk-bob" : ""} ${pulsing ? "echo-tilt" : ""}`}>
          <StyleCrownOrnament agentStyle={agentStyle} />
          <circle cx="0" cy="-2" r="16.8" fill="var(--ink)" opacity="0.16" className={pulsing ? "echo-ring-outer" : ""} />
          <circle cx="0" cy="-2" r="13.5" fill="var(--ink)" opacity="0.34" className={pulsing ? "echo-ring-mid" : ""} />
          <circle cx="0" cy="-2" r="11.6" fill="none" stroke="var(--coral)" strokeWidth="1.3" opacity="0.7" />
          <circle cx="0" cy="-2" r="9.8" fill="var(--ink)" opacity={bodyOpacity} />
          <CharacterEyes yOffset={-2} agentStyle={agentStyle} />
        </g>
      </>
    );
  }
  if (id === "bloom") {
    const idle = state === "idle";
    const dots = [
      { cx: -12, cy: -10, r: 2.9, coral: false },
      { cx: -14, cy: 1, r: 2.4, coral: true },
      { cx: -8, cy: 10, r: 2.7, coral: false },
      { cx: 11, cy: -11, r: 2.6, coral: true },
      { cx: 14.5, cy: -1, r: 2.9, coral: false },
      { cx: 9.5, cy: 9.5, r: 2.4, coral: false },
      { cx: 0, cy: -15, r: 2.5, coral: true },
    ];
    return (
      <>
        <CharacterFeet walking={walking} agentStyle={agentStyle} />
        <g className={walking ? "munshi-walk-bob" : ""}>
          <StyleCrownOrnament agentStyle={agentStyle} />
          <circle cx="0" cy="-2" r="15.2" fill="var(--ink)" opacity="0.15" />
          <g className={blocked ? "" : "bloom-dots-drift"}>
            {dots.map((d) => (
              <circle key={`${d.cx},${d.cy}`} cx={d.cx} cy={d.cy} r={d.r} fill={d.coral ? "var(--coral)" : "var(--ink)"} opacity={0.85} />
            ))}
          </g>
          <circle cx="0" cy="-2" r="10.8" fill="var(--ink)" opacity={bodyOpacity} />
          <CharacterEyes yOffset={-2} sleeping={idle} agentStyle={agentStyle} />
          {idle && !blocked && (
            <text x="14" y="-16" fill="var(--ink)" fontSize="11" fontFamily="var(--font-mono, monospace)" fontWeight="600" className="bloom-z-float">
              z
            </text>
          )}
        </g>
      </>
    );
  }
  // Keeper: the vault, its two slots closing as a note is stored.
  const slot = closingSlots ? 0.8 : 3.2;
  return (
    <>
      <CharacterFeet walking={walking} agentStyle={agentStyle} />
      <g className={walking ? "munshi-walk-bob" : ""}>
        <StyleCrownOrnament agentStyle={agentStyle} />
        <circle cx="0" cy="-2" r="15" fill="var(--ink)" opacity={bodyOpacity} />
        <circle cx="0" cy="-2" r="12.5" fill="none" stroke="var(--edge)" strokeWidth="0.9" opacity="0.35" />
        <rect x={-11.5} y="-9.5" width={slot} height="15" rx="1.2" fill="var(--floor)" stroke="var(--coral)" strokeWidth="0.8" className="keeper-slot" />
        <rect x={11.5 - slot} y="-9.5" width={slot} height="15" rx="1.2" fill="var(--floor)" stroke="var(--coral)" strokeWidth="0.8" className="keeper-slot" />
        <CharacterEyes yOffset={-2} blush={false} agentStyle={agentStyle} />
      </g>
    </>
  );
}

/** One agent as a figure in the given style, with its state drawn over it. Decorative: the scene names the agent. */
export function AgentCharacter({
  id,
  state,
  size = 58,
  waitingCount,
  closingSlots = false,
  agentStyle = "human",
}: {
  id: AgentId;
  state: AgentState;
  size?: number;
  waitingCount?: number | undefined;
  closingSlots?: boolean;
  agentStyle?: AgentStyleId;
}) {
  // Clip paths need ids unique in the page: the same agent can be drawn twice (the room and its camera views).
  const clip = `office-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="-32 -40 64 66" overflow="visible" aria-hidden="true" style={{ opacity: state === "blocked" ? 0.52 : 1 }}>
      {agentStyle === "human" ? (
        <PersonFigure id={id} state={state} closingSlots={closingSlots} />
      ) : agentStyle === "automaton" ? (
        <AutomatonFigure id={id} state={state} />
      ) : (
        <MarkFigure id={id} state={state} agentStyle={agentStyle} closingSlots={closingSlots} clip={clip} />
      )}
      <StateOverlays state={state} waitingCount={waitingCount} />
    </svg>
  );
}
