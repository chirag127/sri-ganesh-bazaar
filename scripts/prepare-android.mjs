import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT, requireCondition, isCli, reportFailure, auditPublicFiles } from './release-readiness.mjs';
import { androidTarget, androidServicesInput, assertAndroidIdentity } from './android-target.mjs';

function validateServices(raw, appId) {
  let value;
  try { value = JSON.parse(raw); } catch { /* Never expose configuration contents. */ }
  const forbidden = input => input && typeof input === 'object' && Object.entries(input).some(([key, child]) =>
    ['private_key', 'private_key_id', 'client_email'].includes(key) || (key === 'type' && child === 'service_account') || forbidden(child));
  requireCondition(value && !Array.isArray(value) && typeof value === 'object' && !forbidden(value) &&
    Array.isArray(value.client) && value.client.some(c => c?.client_info?.android_client_info?.package_name === appId),
  'FIREBASE_PACKAGE', 'Google services must match the Android package and contain no service account.');
  return value;
}

// Validate existing configuration even when an explicit replacement was supplied.
// An invalid local file needs operator attention, not silent destruction.
export async function resolveAndroidServices(servicesPath, appId, explicit, read = readFile) {
  let existing;
  try { existing = await read(servicesPath, 'utf8'); }
  catch (error) {
    requireCondition(error.code === 'ENOENT', 'FIREBASE_READ', 'Existing Google services configuration could not be read.');
  }
  const saved = existing === undefined ? undefined : validateServices(existing, appId);
  const supplied = explicit !== undefined && explicit !== '';
  return { services: supplied ? validateServices(explicit, appId) : saved, write: supplied };
}

export async function prepareAndroid(env = process.env) {
  const root = PROJECT_ROOT;
  const pkg = JSON.parse(await readFile(resolve(root, 'node_modules/@capacitor/cli/package.json'), 'utf8'));
  requireCondition(pkg.version === '8.6.2', 'CLI_VERSION', 'Install the locked Capacitor CLI 8.6.2.');
  await auditPublicFiles(resolve(root, 'dist'), env);
  const target = androidTarget(env);
  await assertAndroidIdentity(root, target);
  const servicesPath = resolve(root, target.path, 'app/google-services.json');
  const { services, write } = await resolveAndroidServices(servicesPath, target.appId, androidServicesInput(env, target.target));
  const childEnv = { ...env, ANDROID_FIREBASE_ENABLED: services ? 'true' : 'false' };
  const cap = (...args) => {
    const result = spawnSync(process.execPath, [resolve(root, 'node_modules/@capacitor/cli/bin/capacitor'), ...args], { cwd: root, env: childEnv, encoding: 'utf8', timeout: 180000 });
    requireCondition(result.status === 0, 'CAPACITOR_FAILED', 'Capacitor generation or sync failed; diagnostics withheld.');
  };
  let exists = true;
  try { await access(resolve(root, target.path)); } catch { exists = false; }
  if (!exists) cap('add', 'android');
  if (write) await writeFile(servicesPath, JSON.stringify(services), { mode: 0o600 });
  cap('sync', 'android');
  const variables = await readFile(resolve(root, target.path, 'variables.gradle'), 'utf8');
  requireCondition(/targetSdkVersion\s*=\s*36\b/.test(variables) && /compileSdkVersion\s*=\s*36\b/.test(variables), 'ANDROID_API', 'Android scaffold must target and compile API 36.');
  const manifestPath = resolve(root, target.path, 'app/src/main/AndroidManifest.xml');
  let manifest = await readFile(manifestPath, 'utf8');
  manifest = manifest.replace('android:allowBackup="true"', 'android:allowBackup="false"');
  if (!manifest.includes('firebase_messaging_auto_init_enabled')) manifest = manifest.replace('</application>', '<meta-data android:name="firebase_messaging_auto_init_enabled" android:value="false" />\n<meta-data android:name="firebase_analytics_collection_enabled" android:value="false" />\n</application>');
  await writeFile(manifestPath, manifest);
  const gradlePath = resolve(root, target.path, 'app/build.gradle');
  let gradle = await readFile(gradlePath, 'utf8');
  if (!gradle.includes('// Environment-only release signing')) {
    gradle += `\n// Environment-only release signing; never persist passwords in properties.\nif (System.getenv('ANDROID_SIGN_RELEASE') == 'true') {\n    android {\n        defaultConfig {\n            versionCode Integer.parseInt(System.getenv('ANDROID_VERSION_CODE'))\n            versionName System.getenv('ANDROID_VERSION_NAME')\n        }\n        signingConfigs {\n            ownerRelease {\n                storeFile file(System.getenv('ANDROID_KEYSTORE_PATH'))\n                storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')\n                keyAlias System.getenv('ANDROID_KEY_ALIAS')\n                keyPassword System.getenv('ANDROID_KEY_PASSWORD')\n            }\n        }\n        buildTypes.release.signingConfig signingConfigs.ownerRelease\n    }\n}\n`;
    await writeFile(gradlePath, gradle);
  }
  process.stdout.write('Android synced with local web assets; no build or device verification claimed.\n');
}
if (isCli(import.meta.url)) prepareAndroid().catch(reportFailure);
