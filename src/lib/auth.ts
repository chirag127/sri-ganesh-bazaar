import { Capacitor } from '@capacitor/core';
import { getApps, initializeApp } from 'firebase/app';
import { getClient } from './api';
import { unregisterPush } from './notifications';
export { requestPush } from './notifications';

export function firebaseApp() {
  const env = import.meta.env;
  if (!env.PUBLIC_FIREBASE_API_KEY || !env.PUBLIC_FIREBASE_PROJECT_ID || !env.PUBLIC_FIREBASE_APP_ID) throw new Error('Firebase push configuration is unavailable.');
  return getApps()[0] ?? initializeApp({ apiKey: env.PUBLIC_FIREBASE_API_KEY, projectId: env.PUBLIC_FIREBASE_PROJECT_ID, appId: env.PUBLIC_FIREBASE_APP_ID, authDomain: env.PUBLIC_FIREBASE_AUTH_DOMAIN, messagingSenderId: env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID });
}
export async function signInGoogle(): Promise<void> {
  // Managed OAuth must not run in the embedded Android WebView. Native callback
  // exchange needs a verified app-link integration before it can be enabled.
  if (Capacitor.isNativePlatform()) throw new Error('Native Google sign-in is awaiting Neon app-link setup. Use the website to sign in.');
  const destination = /^\/admin(?:\/|$)/.test(location.pathname ?? '') ? '/admin/' : '/app/';
  const { error } = await getClient().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${destination}` } });
  if (error) throw new Error('Google sign-in could not be started. Check the Neon trusted domain configuration.');
}
export async function signOut(): Promise<void> {
  await unregisterPush();
  const { error } = await getClient().auth.signOut();
  if (error) throw new Error('Sign-out could not be completed. Please retry.');
}
export async function requestSms(_phone: string): Promise<{status:'code_sent'|'verified'}> {
  throw new Error('SMS verification is unavailable during the Neon migration. Ask the shop for staff confirmation.');
}
export async function confirmSms(_code: string): Promise<void> {
  throw new Error('SMS verification is unavailable during the Neon migration. Ask the shop for staff confirmation.');
}
