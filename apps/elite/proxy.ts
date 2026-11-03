export { proxy } from "@munshi/sites/proxy.ts";

// Next reads the matcher from this file itself, so it is written here, not re-exported. "/" is listed on its own: under
// a base path the second pattern needs a slash after /s/<slug>, so the bare home address would miss the proxy.
export const config = { matcher: ["/", "/((?!_next/|favicon|icon|.*\\.).*)"] };
