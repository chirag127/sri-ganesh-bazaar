import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import storefrontIntegration from './src/layouts/storefront-integration.mjs';

const site = new URL(process.env.PUBLIC_SITE_URL || 'https://vikas.oriz.in');
if (site.protocol !== 'https:' && site.hostname !== 'localhost') {
  throw new Error('PUBLIC_SITE_URL must use HTTPS outside localhost.');
}

export default defineConfig({
  site: site.origin,
  output: 'static',
  trailingSlash: 'always',
  integrations: [react(), storefrontIntegration()],
  build: { format: 'directory' },
  vite: { envDir: false, build: { sourcemap: false } },
});
