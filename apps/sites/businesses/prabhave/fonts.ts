import localFont from "next/font/local";

// Rozha One draws Latin and Devanagari in one hand; Google serves the scripts as two files, so they load as two faces.
export const display = localFont({
  src: "./fonts/rozha-one-latin.woff2",
  weight: "400",
  variable: "--font-display-latin",
  display: "swap",
});

export const displayHindi = localFont({
  src: "./fonts/rozha-one-devanagari.woff2",
  weight: "400",
  variable: "--font-display-deva",
  display: "swap",
  preload: false,
});
