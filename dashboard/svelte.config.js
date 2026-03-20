// Import the Netlify-specific adapter
import adapter from '@sveltejs/adapter-netlify';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Preprocessors handle things like TypeScript or PostCSS before compiling
	preprocess: vitePreprocess(),

	kit: {
		// Executes the Netlify adapter to handle the build output.
		// This translates your SvelteKit routes into Netlify Edge Functions 
		// and static assets, placing them in a 'build' directory by default.
		adapter: adapter()
	}
};

export default config;