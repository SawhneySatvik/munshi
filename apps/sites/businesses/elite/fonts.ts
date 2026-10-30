import localFont from "next/font/local";

// The font pair from the app's fixed palette (fonts are not business material, BLUEPRINT §5.5): Cormorant for the Latin
// display (upright and italic, standing in for the board's Bodoni Moda), Tiro Devanagari Hindi for Hindi headings.
export const display = localFont({
  src: [
    { path: "../../fonts/cormorant-latin.woff2", weight: "500 700", style: "normal" },
    { path: "../../fonts/cormorant-italic-latin.woff2", weight: "500 700", style: "italic" },
  ],
  variable: "--font-display-latin",
  display: "swap",
});

export const displayHindi = localFont({
  src: [
    { path: "../../fonts/tiro-devanagari-hindi.woff2", weight: "400", style: "normal" },
    { path: "../../fonts/tiro-devanagari-hindi-italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-display-deva",
  display: "swap",
  preload: false,
});
