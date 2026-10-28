import localFont from "next/font/local";

// The body face every business shares: Inter for Latin, Noto Sans Devanagari for Hindi (and the ₹ sign, which
// Inter's Latin file lacks).
export const body = localFont({
  src: "../fonts/inter-latin.woff2",
  weight: "400 700",
  variable: "--font-body-latin",
  display: "swap",
});

export const bodyHindi = localFont({
  src: "../fonts/noto-sans-devanagari.woff2",
  weight: "400 700",
  variable: "--font-body-deva",
  display: "swap",
});
