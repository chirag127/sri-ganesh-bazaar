import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Declare your Neon services here
  preview: {
    realtime: true,
  },
  auth: true,
  aiGateway: true,
  functions: {
    ...(process.env.ENABLE_TELEGRAM_ALERTS === 'true' ? {
      adminAlerts: {
        name: "Admin alerts",
        source: "./server/admin-alert-entry.mjs",
        env: {
          ENABLE_TELEGRAM_ALERTS: "true",
          COMMERCE_WORKER_DATABASE_URL: { value: process.env.COMMERCE_WORKER_DATABASE_URL, required: true },
          NOTIFICATION_WORKER_SECRET: { value: process.env.NOTIFICATION_WORKER_SECRET, required: true },
          TELEGRAM_BOT_TOKEN: { value: process.env.TELEGRAM_BOT_TOKEN, required: true },
          TELEGRAM_ADMIN_CHAT_ID: { value: process.env.TELEGRAM_ADMIN_CHAT_ID, required: true },
        },
      },
    } : {}),
    commerce: {
      name: "Commerce API",
      source: "./server/index.mjs",
      env: {
        COMMERCE_DATABASE_URL: { value: process.env.COMMERCE_DATABASE_URL, required: true },
        ALLOWED_ORIGINS: { value: process.env.ALLOWED_ORIGINS, required: true },
        NEON_GOOGLE_ONLY_CONFIRMED: { value: process.env.NEON_GOOGLE_ONLY_CONFIRMED, required: true },
        PAYMENT_EVIDENCE_BUCKET: "assets",
      },
    },
  },
  buckets: {
    // "private" is the default; use "public_read" for anonymous reads
    assets: { access: "private" },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
