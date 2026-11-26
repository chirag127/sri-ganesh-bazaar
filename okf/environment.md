# Scoped runtime environment

The loader in `scripts/environment.mjs` returns a new child environment. It does
not mutate `process.env`, edit files, start services, install dependencies, or
contact providers. Node's built-in `util.parseEnv` supplies parsing; no dotenv
evaluation or shell interpolation is used. Use the repository's pinned Node
requirement (currently Node >=22.23.4; fixture verification used Node 26.13.0).

## Sources and precedence

For explicitly allowed keys, highest priority wins, including deliberate empty
strings:

1. Process/CI environment.
2. `<appDir>/.env.local` (existing developer overrides remain intact).
3. `<appDir>/.env` (app-specific values).
4. An explicitly supplied shared file (common settings).

Shared settings are opt-in. On this workspace pass `--shared C:/ws/.env`;
on another machine pass that machine's absolute shared-file path or omit the
option. There is no parent-directory discovery, implicit umbrella path, or global
export of the umbrella environment. `appDir` and `sharedPath` must be absolute.
Without `--app-dir`, the wrapper uses its own repository root, not the terminal's
working directory. The child runs with that app directory as its working directory.

Missing files, including a missing explicitly selected shared file, are treated
as empty. Permission errors and non-file paths fail closed. Syntax errors fail
before the command starts, identifying only the source label and line number,
never the value or raw line. Quoted multiline values, comments, BOM and CRLF are
supported. Duplicate assignments follow Node parsing (last assignment wins).
Invalid assignment names, unterminated quotes and trailing text after a closing
quote are rejected. Values such as `${HOME}`, `$(command)`, and `%PATH%` remain
data. No variable expansion is performed. Mode files such as `.env.production`
and `.env.production.local` are intentionally not sources.

## Profiles

The same explicit allowlist applies to all four sources, including process/CI.
Unrecognized keys are dropped, not inferred from a `PUBLIC_` prefix.

- `frontend`: `PUBLIC_SITE_URL`, `PUBLIC_COMMERCE_API_URL`,
  `PUBLIC_NEON_AUTH_URL`, `PUBLIC_SHOP_PHONE`, `PUBLIC_SHOP_ADDRESS`,
  `PUBLIC_SHOP_HOURS`, `PUBLIC_ENABLE_SMS`, `PUBLIC_ENABLE_PUSH`,
  `PUBLIC_FIREBASE_API_KEY`, `PUBLIC_FIREBASE_PROJECT_ID`,
  `PUBLIC_FIREBASE_APP_ID`, `PUBLIC_FIREBASE_AUTH_DOMAIN`,
  `PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `PUBLIC_ENABLE_WHATSAPP`,
  `PUBLIC_WHATSAPP_NUMBER`. WhatsApp is click-to-chat only and remains hidden unless
  explicitly enabled with a valid international number; no message is sent automatically.
  The frontend allowlist also includes `PUBLIC_ENABLE_ANALYTICS`,
  `PUBLIC_GA4_MEASUREMENT_ID`, `PUBLIC_ENABLE_CLARITY`, and
  `PUBLIC_CLARITY_PROJECT_ID`. These are public identifiers and opt-in flags,
  not secrets. Provider configuration alone does not establish consent handling
  or verified data collection; those require separate browser checks.
  `PUBLIC_ENABLE_SENTRY` and `PUBLIC_SENTRY_DSN` enable the optional client render-failure
  reporter. It sends a generic failure code and random reference, not raw exceptions,
  stacks, URLs, or customer records. Direct ingestion exposes ordinary network metadata,
  including the client IP, to Sentry. Keep disabled until privacy/configuration review
  and authorized live verification. Server and asynchronous transaction errors are not
  covered by this render-failure reporter.
- `commerce-server`: `COMMERCE_DATABASE_URL`, `NEON_AUTH_BASE_URL`,
  `NEON_AUTH_JWKS_URL`, `NEON_GOOGLE_ONLY_CONFIRMED`, `ALLOWED_ORIGINS`,
  `PAYMENT_EVIDENCE_BUCKET`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`.
- `admin-alerts`: `COMMERCE_WORKER_DATABASE_URL`, `NOTIFICATION_WORKER_SECRET`,
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`, `ENABLE_TELEGRAM_ALERTS`.
  This profile excludes owner and commerce-runtime database credentials. The
  scheduler entry requires an authenticated empty POST; loading these settings
  does not deploy a worker, configure its schedule, or prove message delivery.

The commerce profile deliberately excludes the owner `DATABASE_URL`. Use the
least-privilege commerce role, not an owner connection. The frontend never
receives server or signing keys via this loader. No Android/signing/deployment
profile is supplied: those workflows require separate reviewed, consumed-key
allowlists. Firebase public configuration does not enable or prove SMS/push.

A small process-only execution allowlist preserves OS path/home/temp settings,
locale, terminal/color controls, `CI`, `NODE_ENV`, and `TZ`. File-sourced values
cannot override these. `NODE_OPTIONS`, npm configuration, provider credentials,
and generic CI tokens do not pass through. Windows OS key casing is preserved.
Tools needing additional process keys must be reviewed explicitly; do not replace
this behavior with `{...process.env}`.

## Loader API and command wrapper

```js
import { loadEnvironment } from './scripts/environment.mjs';
const env = await loadEnvironment({
  appDir: 'C:/ws/repos/own/public/apps/sri-ganesh-bazaar',
  profile: 'frontend',
  sharedPath: 'C:/ws/.env', // optional; explicit opt-in
  processEnv: process.env, // optional; tests pass a synthetic object
});
// Pass env to spawn(..., { env, shell: false }); do not log its contents.
```

The wrapper requires a profile, `--`, and a specific command with separate argv:

```sh
node scripts/with-environment.mjs --profile frontend --shared C:/ws/.env -- npm run build
```

The build command above uses the integrated frontend wrapper. For a
server, select `commerce-server` and pass its verified executable/entry point;
`server/index.mjs` exports a fetch handler and is not itself a listening server.
Do not imply that wrapping that file starts a working service.

The wrapper uses `spawn` with `shell: false` and inherited stdio. It forwards
SIGINT/SIGTERM to the immediate child, preserves numeric exit codes, and maps
signal exits to `128 + signal number`. Windows process-tree termination is not
guaranteed. Configuration/usage errors exit 2; missing executables exit 127;
other spawn failures exit 126. Diagnostics never print env values or command
arguments. Child output belongs to the invoked program and is not redacted.

On Windows, `npm.cmd` cannot be safely passed to shell-free spawn. For `npm` or
`npm.cmd`, the wrapper instead runs the installed `npm-cli.js` with the current
Node executable. It checks the standard Node-adjacent Windows and Unix npm
layouts. Nonstandard installations can use `--npm-cli ABSOLUTE_NPM_CLI_JS`.
Other `.cmd` and `.bat` commands are rejected; use an executable or Node entry
point. npm package scripts themselves may use a shell: invoke only trusted
scripts, and never interpolate untrusted values into their script text.

## Applied frontend integration and remaining verification

The `dev`, `build`, `preview`, `check`, and `test` package scripts now use the
frontend wrapper. Astro and Vitest set `envDir: false` to prevent automatic
framework env-file reads. The `test:environment` command is included in local
`verify` and the web CI job. Android/signing and hosted server integration remain
separate boundaries.

**The wrapper alone is not a complete isolation guarantee.** Framework plugins
or application code can still read files independently. The following describes
the applied setup and the checks still required:

1. Applied: `astro.config.mjs` sets `vite.envDir: false`, retaining
   existing build settings. Never set `envDir` to the umbrella directory. Review
   other framework/plugin loaders for independent file reads.
2. Applied package script command bodies include:
   - `dev`: `node scripts/with-environment.mjs --profile frontend -- node node_modules/astro/bin/astro.mjs dev --host 127.0.0.1`
   - `build`: `node scripts/with-environment.mjs --profile frontend -- node node_modules/astro/bin/astro.mjs build`
   - `preview`: `node scripts/with-environment.mjs --profile frontend -- node node_modules/astro/bin/astro.mjs preview --host 127.0.0.1`
   These portable defaults use app files only. Opt into shared settings from an
   outer invocation using the wrapper example above; selected values then reach
   the inner wrapper as process values. Do not make a package script recursively
   invoke itself. The installed Astro CLI path was confirmed before wiring it.
3. Applied separate `test:environment` script:
   `node --test tests/environment/environment.spec.mjs tests/environment/build.spec.mjs`. These Node tests use
   `.spec.mjs` deliberately; the existing Vitest glob selects `.test.*` only.
4. Applied to CI/local verification. Vitest also disables automatic env-file
   loading in its Vite configuration and runs under the scoped frontend profile. Do not run signed Android or release jobs through `frontend` and
   assume their required release attestations/credentials survive filtering.
5. Review the actual commerce hosting adapter and apply `commerce-server` at its
   launch boundary. Hosted provider injection needs its own deployment-specific
   verification. Do not copy frontend profile keys into the server profile merely
   to make unrelated commands work.
6. Validate a fixture-only static build and inspect bundles for sentinel secrets
   after integration. No production env files or current services need to be
   touched for that check. Restart the existing dev server only with approval.

This is process-input scoping, not a filesystem/network sandbox. A child can
still read files, load home-directory npm/AWS configuration, or contact services
if its own code does so. Keep scripts trusted, review downstream loaders, and do
not place secret material in public-named values. No production integration,
credential correctness, signing, deployment, or delivery is claimed here.

## Local fixture verification

From the repository root:

```sh
node --test tests/environment/environment.spec.mjs tests/environment/build.spec.mjs
node --check scripts/environment.mjs
node --check scripts/with-environment.mjs
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json
```

Tests create temporary synthetic files, remove them afterward, and cover layered
precedence/empty overrides, missing files, malformed input, literal malicious-
looking values, key isolation, argv/cwd, command failure propagation, npm entry
points, and Vite's disabled-file-loading handoff. They never load the real app or
umbrella env files. `npm test` uses the wrapper and therefore reads allowed values
from app-local env files; Vitest itself does not reread them. For fixture-only
verification, use synthetic app files and a sanitized process environment. Passing
unit tests is not proof that emitted production bundles contain no secrets.

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
