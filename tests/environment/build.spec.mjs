import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const wrapper = fileURLToPath(new URL('../../scripts/with-environment.mjs', import.meta.url));
const astro = fileURLToPath(new URL('../../node_modules/astro/bin/astro.mjs', import.meta.url));

test('actual Astro build excludes rejected environment values from emitted files', { timeout: 120000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'pashudhan-build-isolation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  // Resolve Astro's package entrypoints without installing or copying dependencies.
  const dependencies = fileURLToPath(new URL('../../node_modules/', import.meta.url));
  await symlink(dependencies, join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await mkdir(join(root, 'src', 'pages'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(join(root, 'astro.config.mjs'), 'export default { vite: { envDir: false }, output: "static" };');
  await writeFile(join(root, '.env'), 'PUBLIC_SHOP_HOURS=ALLOWED_BUILD_SENTINEL\nPUBLIC_UNRELATED=REJECTED_LOCAL_SENTINEL\nCOMMERCE_DATABASE_URL=REJECTED_DATABASE_SENTINEL\n');
  await writeFile(join(root, '.env.production'), 'PUBLIC_SHOP_PHONE=REJECTED_MODE_SENTINEL\n');
  await writeFile(join(root, 'shared.env'), 'PUBLIC_SITE_URL=https://example.test\nAWS_SECRET_ACCESS_KEY=REJECTED_SHARED_SENTINEL\n');
  await writeFile(join(root, 'src', 'pages', 'index.astro'), `---
const values = [import.meta.env.PUBLIC_SITE_URL, import.meta.env.PUBLIC_SHOP_HOURS, import.meta.env.PUBLIC_UNRELATED, import.meta.env.PUBLIC_SHOP_PHONE, process.env.COMMERCE_DATABASE_URL, process.env.AWS_SECRET_ACCESS_KEY];
---
<html><head><title>Isolation fixture</title></head><body><pre>{JSON.stringify(values)}</pre><script>document.body.dataset.fixture = String(import.meta.env.PUBLIC_UNRELATED ?? 'excluded');</script></body></html>`);
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)) env[key] = value;
  }
  env.PUBLIC_UNRELATED = 'REJECTED_PROCESS_SENTINEL';
  const result = spawnSync(process.execPath, [wrapper, '--app-dir', root, '--profile', 'frontend', '--shared', join(root, 'shared.env'), '--', process.execPath, astro, 'build'], { cwd: root, env, encoding: 'utf8', timeout: 90000, maxBuffer: 2000000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  async function contents(dir) {
    const values = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) values.push(await contents(path));
      else if (/\.(html|js|mjs|json)$/.test(entry.name)) values.push(await readFile(path, 'utf8'));
    }
    return values.join('\n');
  }
  const output = await contents(join(root, 'dist'));
  assert.ok(output.includes('ALLOWED_BUILD_SENTINEL'));
  assert.ok(output.includes('https://example.test'));
  assert.doesNotMatch(output, /REJECTED_(LOCAL|DATABASE|MODE|SHARED|PROCESS)_SENTINEL/);
});
