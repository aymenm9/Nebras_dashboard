// adapter-vercel converts SvelteKit routes into Vercel serverless functions.
// Every route (/moderator, /admin, etc.) is handled server-side automatically.
// Already installed: @sveltejs/adapter-vercel is in devDependencies.
import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter()
	}
};

export default config;