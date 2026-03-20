// adapter-vercel converts SvelteKit routes into Vercel serverless functions.
// Every route (/moderator, /admin, etc.) is handled server-side automatically.
// Already installed: @sveltejs/adapter-vercel is in devDependencies.
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		// adapter-static builds pure static files.
		// The fallback serves index.html for every URL so the
		// SvelteKit client router handles /moderator, /admin, etc.
		adapter: adapter({
			fallback: 'index.html'
		})
	}
};

export default config;