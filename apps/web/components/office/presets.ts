// The office's looks: the room's palette (a preset), how the agents are drawn (a style) and where the camera stands
// (a view). All three are view state in the browser; none of them is ever written anywhere but the browser's storage.
import type { Lang } from "../../lib/types";

export type EnvironmentPresetId = "kirana" | "haveli" | "salon" | "monsoon" | "bazaar";
export type AgentStyleId = "human" | "automaton" | "clay" | "brass" | "origami" | "glass";
export type CameraViewMode = "isometric" | "pov_owner" | "pov_agent";

export const PRESETS: EnvironmentPresetId[] = ["kirana", "haveli", "salon", "monsoon", "bazaar"];
export const STYLES: AgentStyleId[] = ["human", "automaton", "clay", "brass", "origami", "glass"];
export const VIEWS: CameraViewMode[] = ["isometric", "pov_owner", "pov_agent"];

// Each preset's palette, set as custom properties on the scene's root (scene.css holds the kirana set as the base).
export const PRESET_VARS: Record<EnvironmentPresetId, Record<string, string>> = {
  kirana: {
    "--paper": "#F8F2E7",
    "--floor": "#FBF6EA",
    "--grid": "#EADFCA",
    "--slab-l": "#D9CCB2",
    "--slab-r": "#CBBD9F",
    "--wall-l": "#EFE5D3",
    "--wall-r": "#E6D9C1",
    "--ink": "#201A13",
    "--ink-muted": "#5C5143",
    "--card": "#FFFDF9",
    "--edge": "#D9CCB2",
    "--coral": "#F2704F",
    "--coral-deep": "#A33A20",
    "--teal": "#0E5E57",
    "--teal-wash": "#DCEFEA",
    "--amber": "#7A4E0E",
    "--amber-wash": "#F5E1B8",
    "--ok": "#2F6A43",
    "--desk-top": "#F3EAD8",
    "--desk-side-l": "#DFD2BA",
    "--desk-side-r": "#CFC0A4",
  },
  haveli: {
    "--paper": "#F9EFEA",
    "--floor": "#FDF5F0",
    "--grid": "#EED9CE",
    "--slab-l": "#DFBFA8",
    "--slab-r": "#CEAA92",
    "--wall-l": "#F4DED3",
    "--wall-r": "#EBD0C2",
    "--ink": "#2B1612",
    "--ink-muted": "#6E4940",
    "--card": "#FFFDFB",
    "--edge": "#E2C2B3",
    "--coral": "#D94E34",
    "--coral-deep": "#8F2512",
    "--teal": "#145A52",
    "--teal-wash": "#D7EFEA",
    "--amber": "#8C580C",
    "--amber-wash": "#F9E4B7",
    "--ok": "#286640",
    "--desk-top": "#F7E6DC",
    "--desk-side-l": "#E4C8B8",
    "--desk-side-r": "#D2B2A0",
  },
  salon: {
    "--paper": "#EEF3EE",
    "--floor": "#F5F9F4",
    "--grid": "#DCE6DA",
    "--slab-l": "#C4D3C2",
    "--slab-r": "#B1C2AF",
    "--wall-l": "#E3ECE1",
    "--wall-r": "#D6E2D4",
    "--ink": "#16231B",
    "--ink-muted": "#4A5E50",
    "--card": "#FCFDFB",
    "--edge": "#C5D4C3",
    "--coral": "#E06748",
    "--coral-deep": "#963820",
    "--teal": "#0F5C4E",
    "--teal-wash": "#D2EDE7",
    "--amber": "#785312",
    "--amber-wash": "#F3E3BD",
    "--ok": "#266B3E",
    "--desk-top": "#EBF1E8",
    "--desk-side-l": "#D2DFCE",
    "--desk-side-r": "#C0CFB8",
  },
  monsoon: {
    "--paper": "#E9EEF0",
    "--floor": "#F4F6F6",
    "--grid": "#D7E0E2",
    "--slab-l": "#BCC8CB",
    "--slab-r": "#A7B5B9",
    "--wall-l": "#DCE4E6",
    "--wall-r": "#CFD9DC",
    "--ink": "#182226",
    "--ink-muted": "#4C5B61",
    "--card": "#FAFDFD",
    "--edge": "#C1CED1",
    "--coral": "#EA6A47",
    "--coral-deep": "#9B381B",
    "--teal": "#0B5560",
    "--teal-wash": "#CBE8EC",
    "--amber": "#80530E",
    "--amber-wash": "#F5E2B8",
    "--ok": "#296844",
    "--desk-top": "#E8ECEC",
    "--desk-side-l": "#CBD4D6",
    "--desk-side-r": "#B8C3C6",
  },
  bazaar: {
    "--paper": "#FAF0DF",
    "--floor": "#FFF8EB",
    "--grid": "#EFE0C4",
    "--slab-l": "#E0C9A2",
    "--slab-r": "#CFB489",
    "--wall-l": "#F5E4C8",
    "--wall-r": "#ECD7B6",
    "--ink": "#26180E",
    "--ink-muted": "#664D38",
    "--card": "#FFFDF8",
    "--edge": "#DFC9A6",
    "--coral": "#F06035",
    "--coral-deep": "#9E2E0E",
    "--teal": "#0E5E57",
    "--teal-wash": "#D8EFEA",
    "--amber": "#8A5205",
    "--amber-wash": "#FCE4AE",
    "--ok": "#2D6A3E",
    "--desk-top": "#F7E9CE",
    "--desk-side-l": "#E5D0AC",
    "--desk-side-r": "#D4BC94",
  },
};

/** The room a shop of this kind opens in: a salon's own, an apparel shop's the bazaar, every other the kirana. */
export function presetForKind(kind: string | null | undefined): EnvironmentPresetId {
  if (kind === "salon") return "salon";
  if (kind === "apparel") return "bazaar";
  return "kirana";
}

// The words of the scene and its controls. No figure in any of them.
export const OFFICE_WORDS: Record<
  Lang,
  {
    room: string;
    look: string;
    camera: string;
    zoom: string;
    zoomIn: string;
    zoomOut: string;
    reset: string;
    tray: string;
    brief: string;
    approved: string;
    cannotVerify: string;
    follow: string;
    talkTo: string;
    room3d: string;
    pov: string;
    said: Record<"finding" | "draft" | "approved" | "message" | "memory", (name: string) => string>;
    preset: Record<EnvironmentPresetId, string>;
    style: Record<AgentStyleId, string>;
    view: Record<CameraViewMode, string>;
  }
> = {
  en: {
    room: "Room",
    look: "Agents",
    camera: "Camera",
    zoom: "Zoom",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    reset: "Reset",
    tray: "YOUR TRAY",
    brief: "MORNING BRIEF",
    approved: "APPROVED",
    cannotVerify: "Cannot verify",
    follow: "Follow",
    talkTo: "Talk to",
    room3d: "The back office, seen from above: the seven agents at their desks, the brief board and your approval tray",
    pov: "The back office seen from your desk: the agents at their desks and your approval tray in front of you",
    said: {
      finding: (n) => `${n} raised a finding and took it to Munshi.`,
      draft: (n) => `${n} put a draft in your tray.`,
      approved: (n) => `A draft from ${n} was approved and filed.`,
      message: (n) => `A customer message arrived for ${n}.`,
      memory: (n) => `${n} stored a note in memory.`,
    },
    preset: { kirana: "Kirana", haveli: "Haveli", salon: "Salon", monsoon: "Monsoon", bazaar: "Bazaar" },
    style: { human: "People", automaton: "Automatons", clay: "Clay marks", brass: "Brass", origami: "Folded paper", glass: "Glass" },
    view: { isometric: "The room", pov_owner: "From your desk", pov_agent: "Follow an agent" },
  },
  hi: {
    room: "कमरा",
    look: "एजेंट",
    camera: "कैमरा",
    zoom: "ज़ूम",
    zoomIn: "पास",
    zoomOut: "दूर",
    reset: "पहले जैसा",
    tray: "आपकी ट्रे",
    brief: "सुबह की रिपोर्ट",
    approved: "मंज़ूर",
    cannotVerify: "पुष्टि नहीं हो सकती",
    follow: "किसके साथ",
    talkTo: "बात करें",
    room3d: "ऊपर से दिखता दफ़्तर: अपनी मेज़ों पर सातों एजेंट, रिपोर्ट का बोर्ड और आपकी मंज़ूरी की ट्रे",
    pov: "आपकी मेज़ से दिखता दफ़्तर: अपनी मेज़ों पर एजेंट और सामने आपकी मंज़ूरी की ट्रे",
    said: {
      finding: (n) => `${n} ने एक बात पकड़ी और मुंशी तक ले गए।`,
      draft: (n) => `${n} ने आपकी ट्रे में एक ड्राफ़्ट रखा।`,
      approved: (n) => `${n} का ड्राफ़्ट मंज़ूर होकर दर्ज हुआ।`,
      message: (n) => `${n} के लिए ग्राहक का संदेश आया।`,
      memory: (n) => `${n} ने एक नोट याद में रखा।`,
    },
    preset: { kirana: "किराना", haveli: "हवेली", salon: "सैलून", monsoon: "मानसून", bazaar: "बाज़ार" },
    style: { human: "लोग", automaton: "यंत्र", clay: "मिट्टी", brass: "पीतल", origami: "कागज़", glass: "काँच" },
    view: { isometric: "पूरा कमरा", pov_owner: "आपकी मेज़ से", pov_agent: "एजेंट के साथ" },
  },
};
