// The demo copy of a site wears the "Sample data" ribbon; the live site sets MUNSHI_LIVE=1 to drop it. Labelled is the
// default, so a build that forgets the flag still says it is a sample.
export const demo = process.env.MUNSHI_LIVE !== "1";
