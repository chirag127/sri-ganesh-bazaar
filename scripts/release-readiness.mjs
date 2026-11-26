import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DEFAULT_APP_ID = 'in.oriz.sriganeshbazaar';
export const ANDROID_API = 36;
export const JAVA_MAJOR = 21;
export const RELEASE_ENVIRONMENT = 'android-release';
export const ATTESTATIONS = Object.freeze([
  'RELEASE_PRIVACY_APPROVED',
  'RELEASE_DATA_SAFETY_APPROVED',
  'RELEASE_DELETION_APPROVED',
  'RELEASE_CONTACT_APPROVED',
  'RELEASE_DEVICE_TESTED',
  'RELEASE_BACKUP_RESTORE_TESTED',
]);

export class ReleaseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReleaseError';
    this.code = code;
  }
}

export function requireCondition(condition, code, message) {
  if (!condition) throw new ReleaseError(code, message);
}

export function isCli(metaUrl) {
  return Boolean(process.argv[1]) && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}

export function reportFailure(error) {
  // Child tools and HTTP errors can contain credentials. Never echo their raw
  // message, response body, command environment, or stack trace in CI output.
  const safe = error instanceof ReleaseError
    ? `${error.code}: ${error.message}`
    : 'RELEASE_FAILED: Command failed; raw diagnostic output was withheld to protect credentials.';
  process.stderr.write(`${safe}\n`);
  process.exitCode = 1;
}

export function appIdFor(env = process.env) {
  const appId = env.ANDROID_APP_ID || DEFAULT_APP_ID;
  requireCondition(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2,}$/.test(appId),
    'INVALID_APP_ID', 'ANDROID_APP_ID must be a lowercase reverse-domain Android package name.');
  return appId;
}

export function releaseVersion(env) {
  const rawCode = env.ANDROID_VERSION_CODE || '';
  const name = env.ANDROID_VERSION_NAME || '';
  requireCondition(/^[1-9]\d{0,9}$/.test(rawCode) && Number(rawCode) <= 2_100_000_000,
    'INVALID_VERSION', 'ANDROID_VERSION_CODE must be a positive Play-compatible integer.');
  requireCondition(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(name) && name.length <= 64,
    'INVALID_VERSION', 'ANDROID_VERSION_NAME must be a bounded semantic version.');
  return { code: Number(rawCode), name };
}

export function normalizeFingerprint(value) {
  const fingerprint = (value || '').replace(/:/g, '').toUpperCase();
  requireCondition(/^[A-F0-9]{64}$/.test(fingerprint), 'INVALID_FINGERPRINT',
    'ANDROID_UPLOAD_CERT_SHA256 must identify the owner-approved upload certificate.');
  return fingerprint;
}

export function assertReleaseContext(env, event, headSha) {
  requireCondition(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch',
    'MANUAL_CI_ONLY', 'Signing and Play upload run only through the manual protected GitHub workflow.');
  const branch = event?.repository?.default_branch;
  requireCondition(typeof branch === 'string' && branch.length > 0 &&
    env.GITHUB_REF === `refs/heads/${branch}` && env.GITHUB_REF_PROTECTED === 'true',
  'PROTECTED_DEFAULT_ONLY', 'Release must use the protected repository default branch, never a PR or tag.');
  requireCondition(env.RELEASE_ENVIRONMENT === RELEASE_ENVIRONMENT &&
    env.RELEASES_ENABLED === 'true' && env.RELEASE_ENVIRONMENT_CONFIGURED === 'true',
  'RELEASE_DISABLED', 'Owner must configure required reviewers, deployment-branch restrictions, and release enablement first.');
  requireCondition(env.RELEASE_APPROVED === 'true' && event?.inputs?.approve === 'true',
    'APPROVAL_REQUIRED', 'The workflow dispatch must explicitly approve this release attempt.');
  if (env.ANDROID_TARGET && env.ANDROID_TARGET !== 'legacy') {
    requireCondition(['customer', 'admin'].includes(env.ANDROID_TARGET) &&
      event?.inputs?.target === env.ANDROID_TARGET,
    'APPROVED_TARGET_REQUIRED', 'The Android target must match the explicitly approved workflow target.');
  }
  const sha = env.GITHUB_SHA || '';
  requireCondition(/^[a-f0-9]{40}$/.test(sha) && sha === env.RELEASE_APPROVED_SHA &&
    sha === event?.inputs?.reviewed_sha && sha === headSha,
  'REVIEWED_SHA_REQUIRED', 'The checked-out commit must exactly match the manually supplied reviewed SHA.');
  for (const name of ATTESTATIONS) {
    requireCondition(env[name] === 'true', 'OPERATIONAL_GATE', `Owner evidence is required for ${name}.`);
  }
}

function requireValues(env, names) {
  for (const name of names) {
    requireCondition(typeof env[name] === 'string' && env[name].trim().length > 0,
      'MISSING_CONFIGURATION', `Required configuration is missing: ${name}.`);
  }
}

function assertPublicHttps(value, name, allowPath = false) {
  let parsed;
  try { parsed = new URL(value); } catch { /* Report only the configuration name. */ }
  requireCondition(parsed?.protocol === 'https:' && !parsed.username && !parsed.password &&
    !parsed.search && !parsed.hash && (allowPath || parsed.pathname === '/') && parsed.hostname.includes('.') &&
    !['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname) &&
    !parsed.hostname.endsWith('.invalid') && !parsed.hostname.endsWith('.example'),
  'INVALID_PUBLIC_URL', `${name} must be an owner-configured public HTTPS URL without credentials.`);
}

export function assertReleaseConfiguration(env, mode) {
  requireCondition(['unsigned', 'signed', 'publish'].includes(mode), 'INVALID_MODE', 'Unknown release-check mode.');
  const appId = appIdFor(env);
  if (mode === 'unsigned') return { appId };
  requireValues(env, ['ANDROID_APP_ID', 'PUBLIC_SITE_URL', 'PUBLIC_NEON_AUTH_URL',
    'PUBLIC_COMMERCE_API_URL', 'PUBLIC_SHOP_PHONE', 'PUBLIC_SHOP_ADDRESS', 'PUBLIC_SHOP_HOURS',
    'ANDROID_UPLOAD_CERT_SHA256']);
  assertPublicHttps(env.PUBLIC_SITE_URL, 'PUBLIC_SITE_URL');
  assertPublicHttps(env.PUBLIC_NEON_AUTH_URL, 'PUBLIC_NEON_AUTH_URL', true);
  assertPublicHttps(env.PUBLIC_COMMERCE_API_URL, 'PUBLIC_COMMERCE_API_URL');
  if (env.PUBLIC_ENABLE_SMS === 'true' || env.PUBLIC_ENABLE_PUSH === 'true') {
    requireValues(env, ['PUBLIC_FIREBASE_API_KEY', 'PUBLIC_FIREBASE_PROJECT_ID',
      'PUBLIC_FIREBASE_APP_ID', 'PUBLIC_FIREBASE_MESSAGING_SENDER_ID']);
  }
  const version = releaseVersion(env);
  normalizeFingerprint(env.ANDROID_UPLOAD_CERT_SHA256);
  requireCondition(['false', 'true', undefined, ''].includes(env.PUBLIC_ENABLE_SMS),
    'INVALID_SMS_FLAG', 'PUBLIC_ENABLE_SMS must be false or true.');
  if (env.PUBLIC_ENABLE_SMS === 'true') {
    requireCondition(env.RELEASE_SMS_BILLING_ACK === 'true', 'SMS_BILLING_GATE',
      'Optional SMS requires separate owner billing acknowledgement; the allowance is not a spending cap.');
  }
  if (mode === 'signed') {
    requireValues(env, ['ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']);
    requireCondition(Boolean(env.ANDROID_KEYSTORE_PATH) !== Boolean(env.ANDROID_KEYSTORE_BASE64),
      'MISSING_SIGNING_KEY', 'Provide exactly one of ANDROID_KEYSTORE_PATH or ANDROID_KEYSTORE_BASE64.');
  }
  if (mode === 'publish') {
    requireCondition(Boolean(env.PLAY_SERVICE_ACCOUNT_FILE) !== Boolean(env.PLAY_SERVICE_ACCOUNT_JSON),
      'MISSING_PLAY_CREDENTIAL', 'Provide exactly one Play service-account input.');
    requireCondition(env.PLAY_UPLOAD_APPROVED === 'true' && env.PLAY_CONSOLE_BOOTSTRAPPED === 'true',
      'PLAY_NOT_APPROVED', 'Play upload needs explicit approval and a completed first Console upload.');
    requireCondition(env.PLAY_TRACK === 'internal' && env.PLAY_RELEASE_STATUS === 'draft',
      'DRAFT_INTERNAL_ONLY', 'Automation only uploads an internal draft. Production promotion remains in Play Console.');
  }
  return { appId, version };
}

export function containsServiceRoleJwt(text) {
  const tokens = String(text).match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [];
  return tokens.some((token) => {
    try {
      return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).role === 'service_role';
    } catch { return false; }
  });
}

const PRIVATE_ENV_NAMES = Object.freeze([
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'BREVO_API_KEY',
  'FIREBASE_SERVICE_ACCOUNT_JSON', 'NOTIFICATION_WORKER_SECRET',
  'PLAY_SERVICE_ACCOUNT_JSON', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_PASSWORD',
  'COMMERCE_DATABASE_URL', 'DATABASE_URL', 'DATABASE_URL_UNPOOLED',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'NEON_AI_GATEWAY_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SENTRY_AUTH_TOKEN',
]);

export function assertPublicContent(content, env = {}) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
  requireCondition(!/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(text) &&
    !/\bsb_secret_[A-Za-z0-9_-]{12,}/.test(text) &&
    !/"(?:private_key|private_key_id)"\s*:/.test(text) && !containsServiceRoleJwt(text),
  'PUBLIC_CREDENTIAL_LEAK', 'Privileged credential material was detected in public build output.');
  for (const name of PRIVATE_ENV_NAMES) {
    const value = env[name];
    if (value && value.length >= 8) {
      requireCondition(!text.includes(value), 'PUBLIC_CREDENTIAL_LEAK',
        'A configured private value was detected in public build output.');
    }
  }
}

export async function auditPublicFiles(directory, env = {}) {
  let files = 0;
  let bytes = 0;
  async function visit(folder) {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      requireCondition(!item.isSymbolicLink(), 'PUBLIC_SYMLINK', 'Public output may not contain symbolic links.');
      const path = resolve(folder, item.name);
      if (item.isDirectory()) {
        await visit(path);
      } else if (item.isFile()) {
        requireCondition(!/^\.env(?:\.|$)/i.test(item.name) &&
          !/(?:service[-_]?account.*\.json|\.(?:jks|keystore|p12|pem))$/i.test(item.name),
        'PRIVATE_PUBLIC_FILE', 'A private configuration or signing file was found in public output.');
        const info = await stat(path);
        bytes += info.size;
        files += 1;
        requireCondition(info.size <= 32 * 1024 * 1024 && bytes <= 256 * 1024 * 1024 && files <= 10_000,
          'PUBLIC_OUTPUT_LIMIT', 'Public-output audit exceeded its bounded size or file-count limit.');
        assertPublicContent(await readFile(path), env);
      }
    }
  }
  await visit(directory);
  requireCondition(files > 0, 'NO_PUBLIC_OUTPUT', 'Build public web assets before checking release readiness.');
  return { files, bytes };
}

export async function requirePrivateFile(path, root = PROJECT_ROOT) {
  requireCondition(typeof path === 'string' && isAbsolute(path), 'PRIVATE_FILE_PATH',
    'Credential files must use absolute paths outside the repository.');
  const actual = await realpath(path);
  const rootPath = await realpath(root);
  const child = relative(rootPath, actual);
  requireCondition(child.startsWith(`..${sep}`) || isAbsolute(child), 'PRIVATE_FILE_PATH',
    'Keep service-account and signing files outside the repository.');
  const info = await lstat(actual);
  requireCondition(info.isFile() && info.size > 0 && info.size <= 1024 * 1024,
    'PRIVATE_FILE_SIZE', 'Credential file is missing or exceeds its size limit.');
  return actual;
}

export async function readReleaseEvent(env) {
  requireCondition(Boolean(env.GITHUB_EVENT_PATH), 'MISSING_EVENT', 'The GitHub workflow event is required.');
  try { return JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8')); }
  catch { throw new ReleaseError('INVALID_EVENT', 'The GitHub event could not be read.'); }
}

export function checkedOutSha(root = PROJECT_ROOT) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  requireCondition(result.status === 0, 'HEAD_UNAVAILABLE', 'The checked-out commit could not be verified.');
  return result.stdout.trim();
}

export async function checkReadiness({ mode = 'unsigned', env = process.env, root = PROJECT_ROOT,
  event, headSha, audit = true } = {}) {
  const config = assertReleaseConfiguration(env, mode);
  if (mode !== 'unsigned') {
    assertReleaseContext(env, event ?? await readReleaseEvent(env), headSha ?? checkedOutSha(root));
  }
  const output = audit ? await auditPublicFiles(resolve(root, 'dist'), env) : undefined;
  return { mode, ...config, output };
}

if (isCli(import.meta.url)) {
  const args = process.argv.slice(2);
  const valid = args.length === 0 || (args.length === 2 && args[0] === '--mode');
  Promise.resolve().then(() => {
    requireCondition(valid, 'INVALID_ARGUMENT', 'Use release-readiness.mjs [--mode unsigned|signed|publish].');
    return checkReadiness({ mode: args[1] || 'unsigned' });
  }).then(({ mode, output }) => {
    process.stdout.write(`${mode} checks passed; ${output.files} public files inspected. This is not deployment or Play approval.\n`);
  }).catch(reportFailure);
}
