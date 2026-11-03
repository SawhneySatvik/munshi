import type { MetadataRoute } from "next";
import { BASE_COLOURS } from "../lib/brand";

// The installable app, served at /manifest.webmanifest. The icons are scripts/icons.mjs's, drawn
// from the site's mark; the colours are the ground (styles/tokens.css). It opens on the owner home.
const ICONS = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
] satisfies MetadataRoute.Manifest["icons"];

export default function manifest(): MetadataRoute.Manifest {
  const ground = BASE_COLOURS["--ground"];
  return {
    id: "/app",
    name: "Munshi",
    short_name: "Munshi",
    description: "The back office for a small shop: counter, stock, buying, books and credit.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    theme_color: ground,
    background_color: ground,
    icons: ICONS,
    shortcuts: [
      { name: "Ask", url: "/app/ask", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Counter", url: "/app/counter", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Stock", url: "/app/stock", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
