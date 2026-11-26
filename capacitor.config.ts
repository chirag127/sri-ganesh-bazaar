import type { CapacitorConfig } from '@capacitor/cli';

import { androidTarget } from './scripts/android-target.mjs';
const target = androidTarget(process.env);
const config: CapacitorConfig = {
  appId: target.appId,
  appName: target.appName,
  webDir: 'dist',
  loggingBehavior: 'none',
  server: {
    hostname: 'localhost',
    appStartPath: target.startPath,
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    path: target.path,
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
    // FirebaseAuth initializes during plugin load. Omit Firebase plugins from
    // unconfigured builds instead of shipping fake google-services credentials.
    includePlugins: [
      '@capacitor/app',
      '@capacitor/browser',
      ...(process.env.ANDROID_FIREBASE_ENABLED === 'true'
        ? ['@capacitor-firebase/authentication', '@capacitor-firebase/messaging']
        : []),
    ],
  },
  plugins: {
    FirebaseAuthentication: {
      // Native Neon OAuth remains separately gated in src/lib/auth.ts.
      // Including this plugin does not enable or verify native sign-in.
      skipNativeAuth: true,
      providers: ['google.com', 'phone'],
    },
  },
};

export default config;
