import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import storefrontIntegration from '../../src/layouts/storefront-integration.mjs';

describe('public offline output', () => {
  it('includes catalog and shell but excludes private routes and push worker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sgb-storefront-'));
    try {
      await mkdir(join(root, 'app'));
      await mkdir(join(root, 'admin'));
      for (const path of ['index.html', 'app/index.html', 'admin/index.html', 'catalog.json', 'private.json', 'firebase-messaging-sw.js']) await writeFile(join(root, path), '{}');
      await storefrontIntegration().hooks['astro:build:done']({ dir: pathToFileURL(root + '/') });
      const worker = await readFile(join(root, 'storefront-worker.js'), 'utf8');
      expect(worker).toContain('"/catalog.json"');
      expect(worker).toContain('"/app/index.html"');
      expect(worker).not.toContain('"/admin/index.html"');
      expect(worker).not.toContain('"/private.json"');
      expect(worker).not.toContain('"/firebase-messaging-sw.js"');
      expect(worker).toContain("request.method !== 'GET'");
      expect(worker).toContain("request.headers.has('Authorization')");
      expect(worker).toContain('ACTIVATE_UPDATE');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
