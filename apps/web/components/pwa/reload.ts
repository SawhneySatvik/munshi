// Leaving the page (a new service worker's takeover, the offline view going back online), apart so a test can see it
// asked for (jsdom cannot reload or navigate).
export const reloadPage = () => window.location.reload();
export const goTo = (path: string) => window.location.replace(path);
