import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // adapter-auto tant que l'hébergement n'est pas choisi.
    adapter: adapter(),
    // SvelteKit ajoute nonces ou hashes à ses propres scripts inline.
    // style-src n'est pas restreint : Vite et les transitions Svelte injectent des styles inline.
    csp: {
      mode: 'auto',
      directives: {
        'script-src': ['self'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self']
      }
    }
  }
};

export default config;
