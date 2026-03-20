/**
 * Disable SSR for the entire app.
 *
 * This app is fully client-side (auth via localStorage/cookies, all data
 * fetched in onMount). Running SSR on Vercel causes pages to be rendered
 * on the server with no user/auth state, breaking navigation and hydration.
 *
 * With ssr = false, SvelteKit behaves like a pure SPA on all adapters:
 * every page is rendered in the browser, exactly like npm run dev.
 */
export const ssr = false;
