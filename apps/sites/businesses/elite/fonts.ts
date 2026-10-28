import localFont from "next/font/local";

// Cormorant for the Latin display (upright and italic); Tiro Devanagari Hindi carries Hindi headings in the same
// calligraphic register. The two stack in theme.css, so each script falls to its own face.
export const display = localFont({
  src: [
    { path: "./fonts/cormorant-latin.woff2", weight: "500 700", style: "normal" },
    { path: "./fonts/cormorant-italic-latin.woff2", weight: "500 700", style: "italic" },
  ],
  variable: "--font-display-latin",
  display: "swap",
});

export const displayHindi = localFont({
  src: [
    { path: "./fonts/tiro-devanagari-hindi.woff2", weight: "400", style: "normal" },
    { path: "./fonts/tiro-devanagari-hindi-italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-display-deva",
  display: "swap",
  preload: false,
});
