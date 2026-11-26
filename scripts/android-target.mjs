import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { appIdFor, requireCondition } from './release-readiness.mjs';

/** New targets require explicit identities; the existing single app remains unchanged. */
export function androidTarget(env = process.env) {
  const target = env.ANDROID_TARGET || 'legacy';
  requireCondition(['legacy', 'customer', 'admin'].includes(target), 'ANDROID_TARGET', 'ANDROID_TARGET must be legacy, customer or admin.');
  if (target === 'legacy') return { target, appId: appIdFor(env), appName: 'Sri Ganesh Bazaar', path: 'android', startPath: '/' };
  const key = target === 'admin' ? 'ANDROID_ADMIN_APP_ID' : 'ANDROID_CUSTOMER_APP_ID';
  requireCondition(Boolean(env[key]), 'ANDROID_TARGET_ID', `Configure ${key} explicitly before creating this target.`);
  const appId = appIdFor({ ANDROID_APP_ID: env[key] });
  const other = target === 'admin' ? env.ANDROID_CUSTOMER_APP_ID : env.ANDROID_ADMIN_APP_ID;
  requireCondition(appId !== other && appId !== appIdFor(env), 'ANDROID_TARGET_COLLISION', 'New target IDs must differ from each other and the legacy app ID.');
  return { target, appId, appName: target === 'admin' ? 'Pashu Saathi Admin' : 'Pashu Saathi', path: `android-${target}`, startPath: target === 'admin' ? '/admin/' : '/app/' };
}

export function androidServicesInput(env, target) {
  if (target === 'legacy') return env.ANDROID_GOOGLE_SERVICES_JSON;
  return env[target === 'admin' ? 'ANDROID_ADMIN_GOOGLE_SERVICES_JSON' : 'ANDROID_CUSTOMER_GOOGLE_SERVICES_JSON'];
}

/** Refuse to repurpose an existing native directory for a different installed identity. */
export async function assertAndroidIdentity(root, target, read = readFile) {
  let gradle;
  try { gradle = await read(resolve(root, target.path, 'app/build.gradle'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const match = gradle.match(/\bapplicationId\s*(?:=\s*)?["']([^"']+)["']/);
  requireCondition(match?.[1] === target.appId, 'ANDROID_IDENTITY_MISMATCH', 'Existing native app identity differs or cannot be verified; preserve the directory and review configuration.');
}
