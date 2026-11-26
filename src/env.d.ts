/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SITE_URL?: string;
  readonly PUBLIC_ENABLE_ANALYTICS?: string;
  readonly PUBLIC_GA4_MEASUREMENT_ID?: string;
  readonly PUBLIC_ENABLE_CLARITY?: string;
  readonly PUBLIC_CLARITY_PROJECT_ID?: string;
  readonly PUBLIC_ENABLE_SENTRY?: string;
  readonly PUBLIC_SENTRY_DSN?: string;
  readonly PUBLIC_NEON_AUTH_URL?: string;
  readonly PUBLIC_COMMERCE_API_URL?: string;
  readonly PUBLIC_ENABLE_WHATSAPP?: string;
  readonly PUBLIC_WHATSAPP_NUMBER?: string;
  readonly PUBLIC_ENABLE_SMS?: string;
  readonly PUBLIC_ENABLE_PUSH?: string;
  readonly PUBLIC_SHOP_PHONE?: string;
  readonly PUBLIC_SHOP_ADDRESS?: string;
  readonly PUBLIC_SHOP_HOURS?: string;
}
