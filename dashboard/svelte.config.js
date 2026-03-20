// Import the Vercel-specific adapter explicitly
import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Preprocessors handle things like TypeScript or PostCSS before compiling
	preprocess: vitePreprocess(),

	kit: {
		// Execute the Vercel adapter to handle the build output.
		// This translates your SvelteKit file-system routes into 
		// strict Vercel Serverless Functions and static assets.
		adapter: adapter({
			// Leaving this configuration object empty uses Vercel's standard defaults.
			// You can define specific Edge configurations or regions here if required later.
		})
	}
};

export default config;