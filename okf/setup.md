# Setup

Project documentation only; no formal OKF schema was supplied and no certification is claimed.

Use the repository's locked dependencies: `npm ci`, then `npm run verify`. Verification includes environment-isolation tests, type checks, unit tests, database fixtures, the static build, and desktop/mobile browser tests. Install Chromium for local E2E with `npx --no-install playwright install chromium`. Unconfigured builds display illustrative catalog content and reject protected writes; they do not authenticate production users.

Use `.env.example` as a name-only reference; never copy it over existing `.env` or `.env.local` values. Shared credentials may remain in `C:/ws/.env`; app-specific configuration belongs in the ignored app-local files. The scoped wrapper loads shared settings only with explicit `--shared C:/ws/.env` and filters every source through the runtime allowlist. See [environment](environment.md) for precedence and commands. Never set Vite `envDir` to the umbrella or expose server/provider/signing values through public settings. Rebuild after public configuration changes; restarting an existing service requires approval.

Use the selected Neon project with reviewed migrations, dedicated commerce_runtime and commerce_worker logins, and Google-only Auth configuration. Configure the actual web origin and provider-supplied callback URLs. Bootstrap the first admin out of band; a client view switch is not authorization. Keep database and storage credentials server-only. See [credentials](credentials.md) and the current [HTTP contract](../server/contract.md). Supply real contact information before release; local fixtures do not establish live authentication or deployment.

Android uses locally bundled `dist`, not a remote website shell. Run `npm run android:sync` to generate the missing scaffold with locked Capacitor CLI 8.6.2 and sync assets. Use JDK 21 and Android SDK platform 36/build-tools 36.0.0 for `npm run android:build`. JDK 27 is rejected. A debug APK is development-signed, not a production release.

Select `ANDROID_TARGET=customer` or `ANDROID_TARGET=admin` in the process environment and supply the corresponding distinct `ANDROID_CUSTOMER_APP_ID` or `ANDROID_ADMIN_APP_ID`. These use separate native directories and shared web assets; the default legacy target preserves the existing identity. Optional target-specific Firebase inputs are `ANDROID_CUSTOMER_GOOGLE_SERVICES_JSON` and `ANDROID_ADMIN_GOOGLE_SERVICES_JSON`; the legacy target uses `ANDROID_GOOGLE_SERVICES_JSON`. Sync preserves valid existing configuration when input is absent, and rejects invalid existing files rather than deleting them. Never commit these files. Register the appropriate Android certificate fingerprints and OAuth audience only against a verified native authentication design. Play app-signing and upload certificates may differ. Native Google login remains fail-closed pending supported Neon session integration and real-device verification; target selection alone does not implement login.

Optional SMS remains disabled by default. Provider allowances and billing terms must be verified for the actual account before enabling; application counters and budget alerts do not guarantee a zero bill. Staff confirmation is a distinct fallback, not an SMS proof or automatic account-linking mechanism.

## Database migration execution

Run `npm run test:migrations` before deployment. For an authorized deployment, supply `MIGRATION_DATABASE_URL` privately for the intended database and run `node scripts/migrate-database.mjs --apply`. This command changes that database: verify the target first. It applies pending migrations and checksum history atomically, serializes competing runners, and rejects changed or non-prefix history. Do not use the disposable database test runner for production migrations. After an interrupted or ambiguous result, inspect migration history before retrying; never manually mark a migration applied to bypass a failure.

See [operations](operations.md) and [releases](releases.md) for secret custody and release gates. These scripts do not change DNS or create a remote account.

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
