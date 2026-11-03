import type { MetadataRoute } from "next";
import { live } from "../lib/variant.ts";

// The live site may be crawled; a copy built as a sample (lib/variant.ts) asks every crawler to stay out.
export default function robots(): MetadataRoute.Robots {
  return { rules: live ? { userAgent: "*", allow: "/" } : { userAgent: "*", disallow: "/" } };
}
