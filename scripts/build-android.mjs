import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import { resolve } from 'node:path';
import { PROJECT_ROOT, requireCondition, checkReadiness, requirePrivateFile, normalizeFingerprint, isCli, reportFailure } from './release-readiness.mjs';

import { androidTarget, assertAndroidIdentity } from './android-target.mjs';

function jdkTool(env, name) {
  return env.JAVA_HOME ? resolve(env.JAVA_HOME, 'bin', process.platform === 'win32' ? `${name}.exe` : name) : name;
}

/** Inspect the selected certificate before signing; passwords never enter argv. */
export function verifyUploadKey(env, run = spawnSync) {
  const result = run(jdkTool(env, 'keytool'), ['-exportcert', '-alias', env.ANDROID_KEY_ALIAS,
    '-keystore', env.ANDROID_KEYSTORE_PATH, '-storepass:env', 'ANDROID_KEYSTORE_PASSWORD'],
  { env, timeout: 10000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  requireCondition(!result.error && result.status === 0, 'SIGNING_CERT_READ', 'Cannot inspect upload certificate; diagnostics withheld.');
  let fingerprint;
  try { fingerprint = new X509Certificate(result.stdout).fingerprint256; } catch { /* Sanitized below. */ }
  requireCondition(Boolean(fingerprint), 'SIGNING_CERT_READ', 'Upload certificate is invalid.');
  requireCondition(normalizeFingerprint(fingerprint) === normalizeFingerprint(env.ANDROID_UPLOAD_CERT_SHA256),
    'SIGNING_CERT_MISMATCH', 'Upload certificate does not match the configured fingerprint.');
}

/** AAB uses JAR signing. Strict verification rejects unsigned entries and wrong aliases. */
export function verifySignedBundle(env, bundle, run = spawnSync) {
  verifyUploadKey(env, run);
  const result = run(jdkTool(env, 'jarsigner'), ['-verify', '-strict', '-keystore', env.ANDROID_KEYSTORE_PATH,
    '-storepass:env', 'ANDROID_KEYSTORE_PASSWORD', bundle, env.ANDROID_KEY_ALIAS],
  { env, timeout: 30000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  requireCondition(!result.error && result.status === 0, 'BUNDLE_SIGNATURE_INVALID', 'Bundle signature verification failed; diagnostics withheld.');
  // jarsigner can return success for an entirely unsigned archive. Require a signer certificate too.
  const cert = run(jdkTool(env, 'keytool'), ['-printcert', '-jarfile', bundle, '-rfc'],
    { env, timeout: 10000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  let fingerprint;
  try { if (!cert.error && cert.status === 0) fingerprint = new X509Certificate(cert.stdout).fingerprint256; } catch { /* Fail closed. */ }
  requireCondition(Boolean(fingerprint) && normalizeFingerprint(fingerprint) === normalizeFingerprint(env.ANDROID_UPLOAD_CERT_SHA256),
    'BUNDLE_CERT_MISMATCH', 'Bundle signer does not match the configured upload certificate.');
}

export async function buildAndroid(env = process.env) {
  const target = androidTarget(env);
  await assertAndroidIdentity(PROJECT_ROOT, target);
  const signed = process.argv.includes('--signed');
  requireCondition(process.argv.slice(2).every(x => x === '--signed'), 'INVALID_ARGUMENT', 'Use build-android.mjs [--signed].');
  await checkReadiness({ mode: signed ? 'signed' : 'unsigned', env: { ...env, ANDROID_APP_ID: target.appId } });
  const java = env.JAVA_HOME ? resolve(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
  const version = spawnSync(java, ['-version'], { encoding: 'utf8', timeout: 10000 });
  requireCondition(version.status === 0 && /version "21[.\"]/.test(version.stderr + version.stdout), 'JDK_REQUIRED', 'Use JDK 21; local JDK 27 is unsupported by the pinned Gradle wrapper.');
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  requireCondition(Boolean(sdk), 'SDK_REQUIRED', 'Configure an Android SDK with platform 36 and build-tools 36.0.0.');
  await access(resolve(sdk, 'platforms/android-36/android.jar'));
  if (signed) {
    requireCondition(Boolean(env.ANDROID_KEYSTORE_PATH), 'KEY_FILE_REQUIRED', 'Materialize the upload keystore outside the repository before building.');
    await requirePrivateFile(env.ANDROID_KEYSTORE_PATH);
    verifyUploadKey(env);
    if (env.PUBLIC_ENABLE_PUSH === 'true' || env.PUBLIC_ENABLE_SMS === 'true') {
      await access(resolve(PROJECT_ROOT, target.path, 'app/google-services.json'));
    }
  }
  const cwd = resolve(PROJECT_ROOT, target.path);
  const args = [signed ? 'bundleRelease' : 'assembleDebug', '--no-daemon', '--console=plain'];
  const command = process.platform === 'win32' ? 'cmd.exe' : 'sh';
  const commandArgs = process.platform === 'win32' ? ['/d', '/c', 'gradlew.bat', ...args] : ['./gradlew', ...args];
  const result = spawnSync(command, commandArgs, { cwd, env: { ...env, ANDROID_SIGN_RELEASE: signed ? 'true' : 'false' }, encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024 });
  requireCondition(result.status === 0, 'GRADLE_FAILED', 'Android build failed; raw output withheld to protect credentials.');
  await access(resolve(cwd, signed ? 'app/build/outputs/bundle/release/app-release.aab' : 'app/build/outputs/apk/debug/app-debug.apk'));
  if (signed) verifySignedBundle(env, resolve(cwd, 'app/build/outputs/bundle/release/app-release.aab'));
  process.stdout.write(signed ? 'Signed bundle built; not uploaded or approved.\n' : 'Debug APK built with development signing only; not a release.\n');
}
if (isCli(import.meta.url)) buildAndroid().catch(reportFailure);
