// Both shops' sites present as the live shops they are: no sample banner, no sample notes on the forms or the
// catalogue, no "sample site" beside the wordmark, and open to search engines. Every sample label on the site reads
// this one switch. A copy that must show itself as a sample (a demo deploy of the same code) builds with
// NEXT_PUBLIC_MUNSHI_SITE_SAMPLE=1; NEXT_PUBLIC_ so the server and the browser's components read the same value.
// (No business is named here: this file is in every business's build.)
export const live = process.env.NEXT_PUBLIC_MUNSHI_SITE_SAMPLE !== "1";
