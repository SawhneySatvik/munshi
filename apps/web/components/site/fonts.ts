import { Akshar, Gabarito } from "next/font/google";

// The site's two faces: Gabarito for Latin display and UI, Akshar for Devanagari. Self-hosted by
// next/font, exposed as CSS variables that site.css reads; imported only by the layouts that frame site pages.
const gabarito = Gabarito({ subsets: ["latin"], variable: "--f-site", display: "swap" });
const akshar = Akshar({ subsets: ["devanagari", "latin"], variable: "--f-site-deva", display: "swap" });

export const SITE_FACES = `${gabarito.variable} ${akshar.variable}`;
