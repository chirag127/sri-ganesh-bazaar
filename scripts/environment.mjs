import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { parseEnv } from 'node:util';

const frontend = Object.freeze([
  'PUBLIC_SITE_URL', 'PUBLIC_COMMERCE_API_URL', 'PUBLIC_NEON_AUTH_URL',
  'PUBLIC_SHOP_PHONE', 'PUBLIC_SHOP_ADDRESS', 'PUBLIC_SHOP_HOURS',
  'PUBLIC_ENABLE_SMS', 'PUBLIC_ENABLE_PUSH', 'PUBLIC_FIREBASE_API_KEY',
  'PUBLIC_FIREBASE_PROJECT_ID', 'PUBLIC_FIREBASE_APP_ID',
  'PUBLIC_FIREBASE_AUTH_DOMAIN', 'PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'PUBLIC_WHATSAPP_NUMBER', 'PUBLIC_ENABLE_WHATSAPP',
  'PUBLIC_ENABLE_ANALYTICS', 'PUBLIC_GA4_MEASUREMENT_ID',
  'PUBLIC_ENABLE_CLARITY', 'PUBLIC_CLARITY_PROJECT_ID',
  'PUBLIC_ENABLE_SENTRY', 'PUBLIC_SENTRY_DSN',
]);
const commerceServer = Object.freeze([
  'COMMERCE_DATABASE_URL', 'NEON_AUTH_BASE_URL', 'NEON_AUTH_JWKS_URL',
  'NEON_GOOGLE_ONLY_CONFIRMED', 'ALLOWED_ORIGINS', 'PAYMENT_EVIDENCE_BUCKET',
  'AWS_ENDPOINT_URL_S3', 'AWS_REGION', 'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
]);
const adminAlerts = Object.freeze([
  'COMMERCE_WORKER_DATABASE_URL', 'NOTIFICATION_WORKER_SECRET',
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID', 'ENABLE_TELEGRAM_ALERTS',
]);
export const environmentProfiles = Object.freeze({
  frontend, 'commerce-server': commerceServer, 'admin-alerts': adminAlerts,
});

// Only process-provided execution conveniences survive, never file-provided ones.
// NODE_OPTIONS, npm config, signing credentials and generic tokens are excluded.
const processKeys = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'TERM', 'COLORTERM', 'NO_COLOR', 'FORCE_COLOR', 'CI', 'NODE_ENV', 'TZ',
]);

function parseFile(text, label) {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  // Node's parser intentionally tolerates malformed lines. Validate first so a
  // misspelled assignment or truncated secret cannot silently become a default.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNumber = i + 1;
    const invalid = () => { throw new Error(`Invalid environment syntax in ${label} at line ${lineNumber}`); };
    if (line.includes('\0')) invalid();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/.exec(line);
    if (!match) invalid();
    const value = match[1];
    const quote = value[0];
    if (quote !== '"' && quote !== "'" && quote !== '`') continue;
    let remainder = value.slice(1);
    while (!remainder.includes(quote)) {
      if (++i >= lines.length) invalid();
      remainder += `\n${lines[i]}`;
    }
    if (remainder.includes('\0')) invalid();
    const trailing = remainder.slice(remainder.indexOf(quote) + 1).trim();
    if (trailing && !trailing.startsWith('#')) invalid();
  }
  try { return parseEnv(normalized); }
  catch { throw new Error(`Invalid environment syntax in ${label}`); }
}

async function readOptional(path, label) {
  let text;
  try { text = await readFile(path, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Cannot read ${label}`);
  }
  return parseFile(text, label);
}

/** Return a fresh, scoped child environment; never mutate process.env or files. */
export async function loadEnvironment({ appDir, profile, sharedPath, processEnv = process.env }) {
  if (!Object.hasOwn(environmentProfiles, profile)) throw new Error('Unknown environment profile');
  if (typeof appDir !== 'string' || !isAbsolute(appDir)) throw new Error('appDir must be absolute');
  if (sharedPath !== undefined && (typeof sharedPath !== 'string' || !isAbsolute(sharedPath))) {
    throw new Error('sharedPath must be absolute');
  }
  const keys = environmentProfiles[profile];
  const result = {};
  const layers = [
    sharedPath === undefined ? {} : await readOptional(sharedPath, 'shared environment'),
    await readOptional(join(appDir, '.env'), 'app .env'),
    await readOptional(join(appDir, '.env.local'), 'app .env.local'),
    processEnv,
  ];
  for (const layer of layers) {
    for (const key of keys) {
      if (Object.hasOwn(layer, key) && typeof layer[key] === 'string') result[key] = layer[key];
    }
  }
  for (const [key, value] of Object.entries(processEnv)) {
    if (processKeys.has(key.toUpperCase()) && typeof value === 'string') result[key] = value;
  }
  return result;
}
