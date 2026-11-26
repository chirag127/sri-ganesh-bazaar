import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

export default function storefrontIntegration() {
  return {
    name: 'public-storefront-offline',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const root = fileURLToPath(dir);
        const files = [];
        async function walk(folder) {
          for (const entry of await readdir(folder, { withFileTypes: true })) {
            const path = join(folder, entry.name);
            if (entry.isDirectory()) await walk(path);
            else files.push(path);
          }
        }
        await walk(root);
        const allowed = files.map(path => '/' + relative(root, path).replaceAll('\\', '/'))
          .filter(path => path === '/catalog.json' || /\.(?:html|css|js|svg|png|webp|avif|woff2)$/.test(path))
          .filter(path => !/firebase|storefront-worker|\/admin\//.test(path));
        const digest = createHash('sha256');
        for (const path of allowed) digest.update(await readFile(join(root, path.slice(1))));
        const version = digest.digest('hex').slice(0, 16);
        const aliases = allowed.filter(path => path.endsWith('/index.html')).map(path => path.slice(0, -10));
        const worker = `const CACHE = 'sgb-public-${version}';
const FILES = ${JSON.stringify(allowed)};
const ALLOWED = new Set([...FILES, ...${JSON.stringify(aliases)}]);
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))));
self.addEventListener('message', event => { if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('sgb-public-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
 const request = event.request; const url = new URL(request.url);
 if (request.method !== 'GET' || url.origin !== self.location.origin || url.search || !ALLOWED.has(url.pathname) || request.headers.has('Authorization')) return;
 const path = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
 event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(path)) || fetch(request)));
});\n`;
        await writeFile(join(root, 'storefront-worker.js'), worker);
      },
    },
  };
}
