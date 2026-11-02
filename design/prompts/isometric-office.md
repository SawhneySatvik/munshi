# Prompt: the Munshi back office, an isometric workspace for AI agents

Paste everything below the line into Gemini. Attach the sample board's screenshots, and any character renders you
picked, as references.

---

## Your task

Design and build **an isometric office where seven AI agents visibly work**, as one self-contained, interactive web
component. It is the centrepiece screen of **Munshi**, an AI back office for small Indian shops (a kirana, a salon, a
boutique). The owner opens this screen and sees their back office alive: agents at desks, walking findings to each
other, carrying drafts to the owner's approval tray. They click any agent to talk to it.

It has to feel alive, calm and trustworthy, like a tiny studio diorama of a real office, and never like a game HUD
or a sci-fi dashboard. Be ambitious with craft: lighting, depth, motion, small delightful details. Every behaviour you
show must map to the data contract in §6, because the real app drives it from database rows.

Make every design decision yourself where this brief is silent, and list those decisions at the end.

## 1. The product truth the scene must express

- **Agents propose; a named person approves.** Agents never change the shop's books themselves. Their work ends as a
  *draft* placed in **the owner's tray**. The tray is the most important object in the room: always visible, always
  front and centre, with a count of drafts waiting.
- **Every number traces to a record.** Any figure an agent shows comes with a small "source chip" (for example
  `↳ day book 30 Oct · row 4`). Agents never show a bare number.
- **Simulated parts are labelled.** Show a small, permanent "Sample shop" label on the scene.

## 2. The room

An isometric diorama: a square floor plate floating on the page background, viewed from the classic 2:1 isometric
angle (about 30°). Suggested size: 8 × 8 floor tiles.

- **Floor:** warm paper (#FBF6EA) with faint tile lines (#EADFCA). The plate has a visible thickness on its two front
  faces (#D9CCB2 and #CBBD9F).
- **Two back walls,** low enough that nothing is hidden: the left wall #EFE5D3, the right wall #E6D9C1.
  - Left wall: **the morning brief board**, a pinned sheet with a coral title line and 3–5 grey lines. Clicking it
    opens the brief.
  - Right wall: a window with soft teal light (#DCEFEA) whose brightness follows the shop's local time of day (morning,
    afternoon, evening, night).
  - Optional: a wall clock showing the shop's local time, and a small shelf of ledgers (books with spines).
- **Seven desks,** one per agent, each with a small dark monitor (#201A13). A monitor shows a faint coral glow while
  its agent works.
- **The lead desk:** round, in the centre, with a coral rim (#F2704F). Munshi floats beside it.
- **The owner's tray:** a low table at the front-centre holding a coral tray with stacked paper drafts. The stack height
  equals the number of waiting drafts (cap the visual at about 6), and a pill reads `YOUR TRAY · N`.
- **Stock corner (optional):** a small shelf rack where Tally goes to "count" when a shelf photo arrives.
- **Small life details** (subtle and optional): a plant, a chai cup with faint steam on the lead desk, papers on desks.
  No brand names, no logos, no text other than the labels this brief names.

Lighting: soft studio light from the upper left; gentle contact shadows under desks and agents; no harsh outlines.
Render it as soft matte clay, not glossy plastic.

## 3. The cast (seven agents)

Each agent is a small, cute, **abstract geometric character**. Its body is its mark. Dot eyes in off-white, small coral
blush on some, two small rounded feet (Munshi has none and floats). No mouths, arms, clothes, human features or faces
beyond the eyes. Body colour is warm near-black (#201A13).

| Agent | Role | Body (its mark) | Personality in motion |
|---|---|---|---|
| **Munshi** | The lead: takes the owner's questions, routes work, checks every number | A solid sphere with one thin tilted orbit ring and a tiny coral moon travelling along it. Floats | Slow, calm hover; the moon orbits faster while it is thinking |
| **Tally** | Stock: counts shelves from photos, finds short or stale stock | A disc of concentric stepped rings (a Fresnel lens), its left half offset upward | Curious; steps between desk and shelf; its rings shift while counting |
| **Ledger** | Money: matches sales, credit and payouts, finds missing money | A solid disc crossed by three horizontal grooves (ruled paper); a thin coral line sweeps across while reading | Methodical; scans; walks findings to Munshi |
| **Dash** | Fixes: turns findings into drafts and carries them to the tray | A disc split along a diagonal slash, its upper half slid forward | The fastest walker; carries a paper card; hops a little |
| **Echo** | Customers: listens to voice notes and WhatsApp, drafts replies | A small core with three fading concentric rings (a sonar pulse) | Rings pulse when a message arrives; tilts its head |
| **Bloom** | Campaigns: writes offers for regulars | A small core inside a soft cloud of tiny drifting dots | Dreamy; the dots drift; dozes when idle |
| **Keeper** | Memory: remembers the owner's decisions and reasons, never numbers | A dense disc with two vertical slots cut into its sides (a vault) | Steady; the slots close briefly when it stores a memory |

These marks are **original to Munshi**. Do not imitate any existing company's logo or mascot.

## 4. States and what each looks like

The data gives every agent exactly one state at a time:

| State | Meaning | Visual |
|---|---|---|
| `idle` | Nothing to do | Still; slow blink; Bloom shows a small floating "z" |
| `watching` | Its scheduled check is running | A soft teal ring breathes on the floor under it; its own idle motion |
| `thinking` | A model call is in progress | Three amber dots in a small bubble above it; its monitor glows |
| `drafting` | Writing a draft | A small paper card beside it with a coral line "being written" |
| `walking` | Carrying a finding to an agent, or a draft to the tray | Walks along the floor grid (never through desks), card in hand, small bob |
| `waiting` | Its draft sits in the owner's tray | Stands near the tray holding a card, with a coral badge showing its count |
| `done` | Its draft was approved in the last few minutes | A small green check pops above it, then it returns to `idle` |
| `blocked` | Over its AI budget, or switched off | Greyed, with a small lock or pause glyph. Never alarming red |

Speech bubbles: each agent may show one short line (≤ 32 characters) from the data, such as
`₹1,240 short on 30 Oct` or `Counting shelf 3`. A bubble showing a figure must carry its source chip on hover or
focus.

## 5. Movement and choreography

- Agents walk on an **isometric path grid** between named spots: their desk, the lead desk, the tray, the shelf and the
  door. Use simple A\* or hand-authored waypoint paths, so nobody crosses a desk. Walk speed is about 1.5 tiles a
  second; Dash is 1.4× faster.
- **Depth sort** by floor position: an agent in front of a desk draws over it, one behind is hidden by it.
- **Event choreography,** played when the data changes:
  1. *A finding is raised:* the owning agent goes `thinking`, then walks to Munshi's desk, and a short line appears.
  2. *A draft is created:* Dash, or the owning agent, picks up a card, walks to the tray and drops it. The stack grows
     by one, then the agent goes `waiting`.
  3. *The owner approves:* the card flies from the tray into the shelf of ledgers, a small `APPROVED` stamp flashes,
     the agent shows `done`, and the tray count drops.
  4. *A message arrives:* Echo's rings pulse, a tiny envelope floats in through the window to Echo.
  5. *A memory is stored:* Keeper's slots close, and a small paper slip slides into it.
- When nothing happens, ambient life only: blinking, hovering, an occasional stretch. No random walking that implies
  work that isn't happening, because every motion that suggests work must come from the data.
- Respect `prefers-reduced-motion`: positions change instantly, with only opacity fades.

## 6. The data contract (must be followed exactly)

The component is driven only by props. No internal fake timers decide what agents do.

```ts
type AgentId = 'munshi' | 'tally' | 'ledger' | 'dash' | 'echo' | 'bloom' | 'keeper';
type AgentState = 'idle' | 'watching' | 'thinking' | 'drafting' | 'walking' | 'waiting' | 'done' | 'blocked';

interface SourceRef { label: string }            // e.g. "day book 30 Oct · row 4", already formatted

interface Agent {
  id: AgentId;
  name: string;                                  // display name, e.g. "Ledger"
  role: string;                                  // e.g. "Money"
  model: string;                                 // e.g. "Muse Spark · reason"
  state: AgentState;
  line?: { text: string; source?: SourceRef };   // the bubble, ≤ 32 chars
  walkTo?: 'desk' | 'lead' | 'tray' | 'shelf' | 'door' | AgentId; // where it heads when state = walking
  waitingCount?: number;                         // drafts of this agent in the tray
}

interface OfficeEvent {                          // one-shot choreography, played once in order
  id: string;
  kind: 'finding' | 'draft' | 'approved' | 'message' | 'memory';
  agent: AgentId;
}

interface OfficeProps {
  shopName: string;                              // "Bansal Super Mart (sample)"
  localTime: string;                             // ISO; drives the window light and the clock
  agents: Agent[];
  trayCount: number;
  events: OfficeEvent[];                         // new ids play their choreography; seen ids are ignored
  sample: boolean;                               // shows the "Sample shop" label
  onSelectAgent(id: AgentId): void;              // click or Enter on an agent
  onOpenTray(): void;
  onOpenBrief(): void;
}
```

Ship a demo harness with the component: a page that feeds a scripted sequence of props (a finding, then a draft, an
approval, a message and a memory) so every choreography can be seen, plus buttons to fire each event by hand.

## 7. Talking to an agent

Clicking (or focusing and pressing Enter on) an agent:
- highlights it with a coral floor ring, and gently pans or zooms the camera toward it (subtle, at most 1.15×);
- calls `onSelectAgent(id)`. The host app opens the chat panel, so **do not build the chat yourself**. Do provide a
  matching side-panel *shell* in the demo harness (header with the agent's mark, name, role, model and state chip; a
  message list; an input with a voice button) so the look is consistent;
- while that agent is selected and `thinking`, its bubble shows the three-dot animation.

## 8. Technical requirements

- **Target:** a React 19 + TypeScript client component for a Next.js 16 app (`'use client'`).
- **Rendering:** SVG for the room and characters (crisp at any zoom, accessible, styleable). Canvas or WebGL only if
  you justify it, and then with an SVG or DOM layer for focus and labels.
- **Motion:** the `motion` package (Framer Motion) is allowed, as is plain CSS or the Web Animations API. No other
  runtime dependencies. No external images, fonts or network calls; everything is drawn in code. The fonts are
  Gabarito (UI), Literata (titles) and IBM Plex Mono (labels), loaded by the host app; use CSS variables.
- **Layout:** the scene fits its container (min 720 px, max 1200 px wide) and keeps the isometric aspect. Below
  720 px, render a simpler row of agent cards with the same states.
- **Performance:** 60 fps on a mid-range laptop; at most about 300 animated nodes; animation pauses when the tab is
  hidden.
- **Accessibility:**
  - every agent is a real `<button>` with an `aria-label` such as "Ledger, money, drafting. Talk to Ledger";
  - a visually hidden live region announces events ("Dash put a draft in your tray");
  - the tray and the brief board are buttons;
  - text contrast is at least 4.5:1.
- **Theming:** every colour is a CSS custom property, with these defaults:

```
--paper #F8F2E7   --floor #FBF6EA   --grid #EADFCA   --wall-l #EFE5D3   --wall-r #E6D9C1
--ink #201A13     --card #FFFDF9    --edge #D9CCB2   --coral #F2704F    --coral-deep #A33A20
--teal #0E5E57    --teal-wash #DCEFEA --amber #7A4E0E --amber-wash #F5E1B8 --ok #2F6A43
```

  Also provide a dark variant (page #151312, characters #F2ECE6, coral #FF7F61) switched by a `data-theme="dark"`
  attribute.

## 9. Deliverables

1. `IsometricOffice.tsx`, the component, typed exactly as in §6.
2. `characters.tsx`, the seven characters as separate SVG components, each taking `state` and `size`.
3. `paths.ts`, the floor grid, named spots, waypoints and depth-sorting helpers.
4. `demo.tsx`, the harness from §6 with the side-panel shell from §7.
5. A short `README.md`: how the coordinates work, how to add a desk or an agent, and the design decisions you made
   where this brief was silent.

## 10. How it will be judged

- [ ] At a glance, a stranger understands "these are AI workers, and the tray is where I approve their work".
- [ ] Every state in §4 and every event in §5 is visible in the demo, and each follows only the props.
- [ ] Nobody walks through furniture; depth sorting is correct everywhere.
- [ ] Every figure in a bubble has its source; no number appears without one.
- [ ] Keyboard-only: you can reach and select every agent, the tray and the brief.
- [ ] Reduced motion works.
- [ ] Light and dark themes both work.
- [ ] 60 fps.
- [ ] It is charming: small, calm, crafted, original.
