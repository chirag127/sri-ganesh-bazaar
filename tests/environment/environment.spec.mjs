import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const wrapper = fileURLToPath(new URL('../../scripts/with-environment.mjs', import.meta.url));
const moduleUrl = new URL('../../scripts/environment.mjs', import.meta.url);
async function fixture(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'environment-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appDir = join(root, 'app');
  await mkdir(appDir);
  for (const [name, value] of Object.entries(files)) await writeFile(join(root, name), value);
  return { appDir, sharedPath: join(root, 'shared.env'), root };
}
async function load(options) { return (await import(moduleUrl)).loadEnvironment(options); }
function cli(appDir, args, env = {}) {
  return spawnSync(process.execPath, [wrapper, '--app-dir', appDir, ...args], {
    cwd: appDir, env, encoding: 'utf8', timeout: 15000,
  });
}

test('process wins over local, app, and explicitly allowed shared settings without mutation', async t => {
  const paths = await fixture(t, { 'shared.env': 'PUBLIC_SITE_URL=shared\nPUBLIC_SHOP_PHONE=shared-phone',
    'app/.env': 'PUBLIC_SITE_URL=app\nPUBLIC_SHOP_ADDRESS=app-address',
    'app/.env.local': 'PUBLIC_SITE_URL=local\nPUBLIC_SHOP_HOURS=local-hours' });
  const processEnv = { PUBLIC_SITE_URL: 'ci' };
  assert.deepEqual(await load({ ...paths, profile: 'frontend', processEnv }), {
    PUBLIC_SITE_URL: 'ci', PUBLIC_SHOP_PHONE: 'shared-phone',
    PUBLIC_SHOP_ADDRESS: 'app-address', PUBLIC_SHOP_HOURS: 'local-hours',
  });
  assert.deepEqual(processEnv, { PUBLIC_SITE_URL: 'ci' });
});

test('local overrides app and app overrides shared', async t => {
  const paths = await fixture(t, { 'shared.env': 'PUBLIC_SITE_URL=shared\nPUBLIC_SHOP_PHONE=shared',
    'app/.env': 'PUBLIC_SITE_URL=app\nPUBLIC_SHOP_PHONE=app', 'app/.env.local': 'PUBLIC_SITE_URL=local' });
  assert.deepEqual(await load({ ...paths, profile: 'frontend', processEnv: {} }), {
    PUBLIC_SITE_URL: 'local', PUBLIC_SHOP_PHONE: 'app',
  });
});

for (const layer of ['process', '.env.local', '.env']) {
  test(`deliberate empty ${layer} overrides lower values`, async t => {
    const files = { 'shared.env': 'PUBLIC_SITE_URL=shared' };
    if (layer !== 'process') files[`app/${layer}`] = 'PUBLIC_SITE_URL=';
    const paths = await fixture(t, files);
    assert.equal((await load({ ...paths, profile: 'frontend', processEnv: layer === 'process' ? { PUBLIC_SITE_URL: '' } : {} })).PUBLIC_SITE_URL, '');
  });
}

test('missing optional files are empty, without ancestor discovery', async t => {
  const paths = await fixture(t, { '.env': 'PUBLIC_SITE_URL=parent', 'shared.env': 'PUBLIC_SITE_URL=not-opted-in' });
  assert.deepEqual(await load({ appDir: paths.appDir, profile: 'frontend', processEnv: {} }), {});
  assert.deepEqual(await load({ ...paths, sharedPath: join(paths.root, 'missing'), profile: 'frontend', processEnv: {} }), {});
});

test('frontend rejects unrelated public keys and server/signing secrets from every layer', async t => {
  const forbidden = { PUBLIC_UNRELATED: 'other', COMMERCE_DATABASE_URL: 'secret', AWS_SECRET_ACCESS_KEY: 'secret',
    ANDROID_KEYSTORE_PASSWORD: 'secret', DATABASE_URL: 'owner', NODE_OPTIONS: '--require bad', NPM_TOKEN: 'secret' };
  const text = Object.entries(forbidden).map(([key, value]) => `${key}=${value}`).join('\n');
  const paths = await fixture(t, { 'shared.env': text, 'app/.env': text, 'app/.env.local': text });
  assert.deepEqual(await load({ ...paths, profile: 'frontend', processEnv: forbidden }), {});
});

test('commerce-server allows consumed server keys but not owner database, signing, or public values', async t => {
  const paths = await fixture(t, { 'shared.env': 'COMMERCE_DATABASE_URL=runtime\nDATABASE_URL=owner\nAWS_SECRET_ACCESS_KEY=s3\nANDROID_KEYSTORE_PASSWORD=signing\nPUBLIC_SITE_URL=public\nNEON_AUTH_BASE_URL=https://auth.invalid\nALLOWED_ORIGINS=https://site.invalid' });
  assert.deepEqual(await load({ ...paths, profile: 'commerce-server', processEnv: {} }), {
    COMMERCE_DATABASE_URL: 'runtime', AWS_SECRET_ACCESS_KEY: 's3',
    NEON_AUTH_BASE_URL: 'https://auth.invalid', ALLOWED_ORIGINS: 'https://site.invalid',
  });
});

test('admin alerts isolate worker secrets from frontend and commerce profiles', async t => {
  const values = { COMMERCE_WORKER_DATABASE_URL: 'worker-fixture', NOTIFICATION_WORKER_SECRET: 'scheduler-fixture', TELEGRAM_BOT_TOKEN: 'bot-fixture', TELEGRAM_ADMIN_CHAT_ID: '12345', ENABLE_TELEGRAM_ALERTS: 'false' };
  const paths = await fixture(t, { 'shared.env': Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') });
  assert.deepEqual(await load({ ...paths, profile: 'admin-alerts', processEnv: { DATABASE_URL: 'owner', COMMERCE_DATABASE_URL: 'runtime', PUBLIC_SITE_URL: 'public' } }), values);
  for (const profile of ['frontend', 'commerce-server']) {
    assert.deepEqual(await load({ ...paths, profile, processEnv: values }), {});
  }
});

test('OS settings come only from the process, with Windows casing preserved', async t => {
  const paths = await fixture(t, { 'shared.env': 'PATH=bad\nSystemRoot=bad', 'app/.env': 'HOME=bad' });
  assert.deepEqual(await load({ ...paths, profile: 'frontend', processEnv: { Path: 'safe', SystemRoot: 'windows', HOME: 'home', CI: 'true', UNKNOWN: 'no' } }), {
    Path: 'safe', SystemRoot: 'windows', HOME: 'home', CI: 'true',
  });
});

test('quoted values, comments, BOM, CRLF and multiline values are parsed as data', async t => {
  const paths = await fixture(t, { 'app/.env': '﻿# fixture\r\nexport PUBLIC_SHOP_ADDRESS="first\r\nsecond # inside"\r\nPUBLIC_SHOP_PHONE=123 # comment\r\nPUBLIC_SHOP_HOURS=\'$(touch nope); `whoami` ${HOME} %PATH%\'\r\n' });
  assert.deepEqual(await load({ ...paths, profile: 'frontend', processEnv: {} }), {
    PUBLIC_SHOP_ADDRESS: 'first\nsecond # inside', PUBLIC_SHOP_PHONE: '123',
    PUBLIC_SHOP_HOURS: '$(touch nope); `whoami` ${HOME} %PATH%',
  });
});

for (const malformed of ['PUBLIC_SITE_URL="private-value', 'NOT AN ASSIGNMENT private-value', 'PUBLIC_SITE_URL="ok" private-value', '1BAD=private-value']) {
  test(`malformed fixture ${JSON.stringify(malformed.split('=')[0])} fails without disclosing its content`, async t => {
    const paths = await fixture(t, { 'app/.env': malformed });
    await assert.rejects(load({ ...paths, profile: 'frontend', processEnv: {} }), error => {
      assert.match(error.message, /Invalid environment syntax.*line 1/);
      assert.ok(!error.message.includes('private-value'));
      return true;
    });
  });
}

test('unknown profile and relative paths are rejected before reading files', async t => {
  const paths = await fixture(t);
  await assert.rejects(load({ ...paths, profile: 'all', processEnv: {} }), /Unknown environment profile/);
  await assert.rejects(load({ appDir: '.', profile: 'frontend', processEnv: {} }), /absolute/);
  await assert.rejects(load({ ...paths, sharedPath: '.env', profile: 'frontend', processEnv: {} }), /absolute/);
});

test('non-file read errors fail closed without leaking contents', async t => {
  const paths = await fixture(t);
  await mkdir(join(paths.appDir, '.env'));
  await assert.rejects(load({ ...paths, profile: 'frontend', processEnv: {} }), /Cannot read app .env/);
});

test('wrapper preserves literal argv, cwd and selected values without invoking a shell', async t => {
  const paths = await fixture(t, { 'app/.env': 'PUBLIC_SITE_URL=https://fixture.invalid\nPUBLIC_OTHER=reject\nCOMMERCE_DATABASE_URL=secret' });
  const argument = '$(touch nope) & echo no; %PATH% "quoted"';
  const result = cli(paths.appDir, ['--profile', 'frontend', '--', process.execPath, '-e',
    'console.log(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd(),site:process.env.PUBLIC_SITE_URL,other:process.env.PUBLIC_OTHER,secret:process.env.COMMERCE_DATABASE_URL}))', argument]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { args: [argument], cwd: paths.appDir, site: 'https://fixture.invalid' });
});

test('wrapper propagates command failure exit code', async t => {
  const { appDir } = await fixture(t);
  const result = cli(appDir, ['--profile', 'frontend', '--', process.execPath, '-e', 'process.exit(23)']);
  assert.equal(result.status, 23, result.stderr);
});

test('wrapper returns 127 for missing executable with a value-free diagnostic', async t => {
  const { appDir } = await fixture(t);
  const result = cli(appDir, ['--profile', 'frontend', '--', 'missing-private-value-command']);
  assert.equal(result.status, 127);
  assert.ok(!result.stderr.includes('private-value'));
});

test('wrapper fails closed for missing profile, delimiter, and command', async t => {
  const { appDir } = await fixture(t);
  for (const args of [['--', process.execPath], ['--profile', 'frontend', process.execPath], ['--profile', 'frontend', '--']]) {
    assert.equal(cli(appDir, args).status, 2);
  }
});

test('wrapper passes only opt-in shared frontend keys through Vite with file loading disabled', async t => {
  const paths = await fixture(t, {
    'shared.env': 'PUBLIC_SITE_URL=https://shared.invalid\nPUBLIC_UNRELATED=private-value\nAWS_SECRET_ACCESS_KEY=private-value',
    'app/.env': 'PUBLIC_SHOP_HOURS=\'${HOME} $(whoami)\'\nPUBLIC_UNRELATED=local-private-value',
    'app/.env.production': 'PUBLIC_SHOP_PHONE=mode-file-must-not-load',
  });
  const viteUrl = new URL('../../node_modules/vite/dist/node/index.js', import.meta.url).href;
  const code = `const {loadEnv}=await import(process.argv[1]); console.log(JSON.stringify(loadEnv('production',false,'PUBLIC_')))`;
  const result = cli(paths.appDir, ['--profile', 'frontend', '--shared', paths.sharedPath,
    '--', process.execPath, '-e', code, viteUrl]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    PUBLIC_SITE_URL: 'https://shared.invalid', PUBLIC_SHOP_HOURS: '${HOME} $(whoami)',
  });
});

test('wrapper rejects batch commands without executing their contents', async t => {
  const { appDir } = await fixture(t);
  const result = cli(appDir, ['--profile', 'frontend', '--', 'private-value.cmd']);
  assert.equal(result.status, 2);
  assert.ok(!result.stderr.includes('private-value'));
});

test('wrapper supports explicit npm entry point with literal arguments', async t => {
  const { appDir, root } = await fixture(t, {
    'npm-cli.js': 'console.log(JSON.stringify(process.argv.slice(2))); process.exitCode=17;',
  });
  const result = cli(appDir, ['--profile', 'frontend', '--npm-cli', join(root, 'npm-cli.js'),
    '--', 'npm', 'space & semicolon; $(whoami)']);
  assert.equal(result.status, 17, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['space & semicolon; $(whoami)']);
});

test('wrapper runs installed npm via Node on this platform, without a shell', async t => {
  const { appDir } = await fixture(t);
  const result = cli(appDir, ['--profile', 'frontend', '--', 'npm', '--version']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
});
