# Operations

Project documentation only; no formal OKF schema or certification is claimed.

Keep encrypted backups of both PostgreSQL and private Storage objects with access policies and restore instructions. Database-only exports do not preserve uploaded evidence. Test restoration in an isolated private environment. Never put backups, customer data, screenshots or tokens in public Actions artifacts. Define retention and authorized operators before launch.

Monitor quota, failed notification delivery and expired reservation processing. Provider free tiers are not perpetual availability guarantees. Optional Blaze SMS and its stated 10 sends/day allowance do not impose a hard zero-bill ceiling. Keep SMS disabled unless separately approved; use documented staff confirmation when appropriate. No automatic billing enablement exists.

Privacy/Data Safety declarations must reflect actual Google login, phone contact, notifications and private evidence processing. Test deletion requests end-to-end, including staff processing, identity checks, retention required for bills and deletion from applicable stores/backups. Publish accurate contact details and retention policy before release.

## Configuration inventory (names only)

Public app settings and acquisition instructions are maintained in `.env.example`. The active commerce client uses `PUBLIC_NEON_AUTH_URL` and `PUBLIC_COMMERCE_API_URL`, not Supabase endpoints. Only explicitly allowlisted settings enter frontend builds; see `environment.md`. Analytics, Clarity, Sentry and WhatsApp remain separately gated integrations; configured identifiers do not prove live operation.

Commerce server: dedicated `COMMERCE_DATABASE_URL`, Neon Auth issuer/JWKS configuration, exact `ALLOWED_ORIGINS`, and private Neon S3 credentials. The alert worker separately uses `COMMERCE_WORKER_DATABASE_URL`, `NOTIFICATION_WORKER_SECRET`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_ADMIN_CHAT_ID`. Never substitute an owner connection or share runtime and worker privileges. See `../server/contract.md` for endpoint and configuration requirements. Legacy Supabase notification code is not a deployed Neon integration.

Protected signing secrets: ANDROID_GOOGLE_SERVICES_JSON, ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD. Local external-file alternative: ANDROID_KEYSTORE_PATH. Reserved blocked Play inputs: PLAY_SERVICE_ACCOUNT_FILE, PLAY_SERVICE_ACCOUNT_JSON. Never use PUBLIC_ for these inputs.

Release variables: ANDROID_APP_ID, ANDROID_VERSION_CODE, ANDROID_VERSION_NAME, ANDROID_UPLOAD_CERT_SHA256, RELEASES_ENABLED, RELEASE_ENVIRONMENT_CONFIGURED, RELEASE_PRIVACY_APPROVED, RELEASE_DATA_SAFETY_APPROVED, RELEASE_DELETION_APPROVED, RELEASE_CONTACT_APPROVED, RELEASE_DEVICE_TESTED, RELEASE_BACKUP_RESTORE_TESTED. Optional SMS gate: RELEASE_SMS_BILLING_ACK. Dispatch/context gates: RELEASE_ENVIRONMENT, RELEASE_APPROVED, RELEASE_APPROVED_SHA. Reserved Play gates: PLAY_UPLOAD_APPROVED, PLAY_CONSOLE_BOOTSTRAPPED, PLAY_TRACK, PLAY_RELEASE_STATUS.

Restrict Google API keys to appropriate application identities where supported. Public Firebase client configuration is not a service account. Keep Play app-signing and upload-key custody separate; document recovery, owners and fingerprints. No operational script changes DNS.

**[chirag@oriz.in](mailto:chirag@oriz.in)**

<footer class="hire-me">
    <h3>Hire me</h3>
    <p>Chirag Singhal — building free, open APIs and tools.</p>
    <p>
        <a href="mailto:chirag@oriz.in">chirag@oriz.in</a> ·
        <a href="https://github.com/chirag127">GitHub</a> ·
        <a href="https://www.linkedin.com/in/chirag127/">LinkedIn</a> ·
        <a href="https://x.com/singhal127">X</a> ·
        <a href="https://www.youtube.com/@ChiragSinghal127">YouTube</a> ·
        <a href="https://www.instagram.com/chiragsinghal127/">Instagram</a> ·
        <a href="https://www.reddit.com/user/Far_Macaron_9910/">Reddit</a> ·
        <a href="https://buymeacoffee.com/chirag127">Buy me a coffee</a>
    </p>
</footer>
