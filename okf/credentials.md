# Credentials and configuration

This is a **name-only setup inventory**, not proof that all integrations work. The app is migrating to Neon. The example intentionally identifies legacy consumers rather than pretending that provisioning Neon already migrates the application. Never paste actual tokens into chat, Git, documentation, screenshots, or public build artifacts.

## Where values belong

- `.env.example`: blanks and safe defaults only.
- Ignored app-local `.env.local`: local private configuration. Preserve values already pulled by the CLI; do **not** overwrite this file by copying the example over it.
- Frontend build settings: only the reviewed `PUBLIC_*` allowlist. These values are visible to every visitor and APK recipient.
- Neon Function environment: API database credential and operational secrets needed by that function only. Declare intended variables in `neon.ts`; a local file alone does not configure deployed Functions.
- GitHub `android-release` environment secrets: signing/service-account material. Use environment variables for nonsecret settings and evidence-based release gates.
- Workspace `SGB_*` aliases: a documentation/convenience namespace only. Manually remove `SGB_` when copying each approved value into its destination. Never point Astro/Vite at the complete umbrella environment file.

No environment file is automatically loaded by an arbitrary standalone Node script. Release scripts currently read the process environment; GitHub supplies it explicitly. Never globally export all application secrets just to run a public build.

## 1. Neon CLI and service-generated configuration

The CLI is installed and OAuth sign-in has been observed by the coordinator. To sign in on a different computer, run `neon login` in an interactive terminal and finish the browser flow. Do not generate an account-wide API key merely to replace a working OAuth session.

From the application directory, with the correct project and branch linked:

```sh
neon --version
neon status
neon env pull
```

`env pull` obtains the selected branch's declared service values into the ignored local environment file. It can write credentials: inspect the destination before using it, do not print its contents, and do not run it as a substitute for verifying the target branch.

Generated names currently relevant to the setup:

| Names | Purpose and destination |
|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Pooled/direct database URLs for operator tooling and migrations. Treat as secrets; the pulled default may be owner-privileged. |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL` | Auth endpoint and signing-key discovery endpoint; obtained after Auth is provisioned. Server validates tokens against this fixed configuration. |
| `NEON_BRANCH`, `NEON_BRANCH_ID`, `NEON_FUNCTION_HOST_SUFFIX` | Nonsecret branch/function routing metadata. |
| `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Neon Object Storage endpoint and credentials, not credentials to an unrelated AWS account. Optional `AWS_SESSION_TOKEN` only if provided by Neon. |
| `NEON_AI_GATEWAY_TOKEN`, `NEON_AI_GATEWAY_BASE_URL` | Secret model credential and endpoint. Provisioning does not supply inference credits. No AI feature is needed for basic shop ordering. |

Do not invent missing values. Empty function/bucket maps are not implemented services. AI Gateway currently needs available credits/models before an inference test can succeed; obtaining paid credits is a separate decision.

### Restricted database identities

The HTTP server reads **`COMMERCE_DATABASE_URL`**, deliberately without a fallback to `DATABASE_URL`. A migration operator must create a dedicated login, grant it **only `commerce_runtime`**, and obtain that login's pooled connection string through Neon Connect or supported CLI tooling. Use a separate login inheriting **only `commerce_worker`** for jobs. Neither login may be the owner, superuser, or a member of both runtime and worker roles. The admin-alert worker reads `COMMERCE_WORKER_DATABASE_URL`; it never falls back to the owner or runtime connection. Configure it only for the separate scheduler handler in `server/admin-alert-entry.mjs`. Its presence does not establish that the worker is deployed or scheduled.

After validating the real Neon identity, the HTTP server begins a transaction, calls `commerce_identity.begin_request(...)`, and executes the allowed RPC on that same connection. Browser-provided user IDs are not a substitute. The operator should verify role membership and denials before production; creating a password alone does not establish least privilege.

### Google login

Use the linked project's Neon Auth settings and the installed Neon Auth guidance to configure Google and exact trusted redirect origins. If the account requires custom Google OAuth credentials, create the OAuth client in Google Cloud's Google Auth Platform, configure consent and the **exact callback URL supplied by Neon**, and enter the client secret in Neon Auth—not in this application's public environment. Do not guess callback URLs or add wildcard origins.

`NEON_GOOGLE_ONLY_CONFIRMED` is an operational assertion, not an OAuth secret. Leave it false until the provider policy and actual signed token claims have been tested. `ALLOWED_ORIGINS` permits explicit website and native origins; it does not itself authorize a customer or grant admin rights. Keep local development origins out of production unless explicitly required.

`PAYMENT_EVIDENCE_BUCKET` defaults to `assets`, matching the current `neon.ts`. Verify private access, owner isolation, upload limits, and signed downloads. Storage credentials must remain server-only.

## 2. Optional Firebase phone verification and push

Google account login and phone verification are separate. Keep both feature flags false until the relevant Neon endpoints and token/device lifecycle are implemented and tested.

1. Open Firebase Console, choose the intended project, and register a Web app under **Project settings → General → Your apps**.
2. Copy the Web SDK configuration fields individually to matching `PUBLIC_FIREBASE_*` values. A Firebase Web API key is client configuration, not an administrative credential; configure supported API/application restrictions and abuse protections.
3. For web push, obtain the public VAPID key under **Cloud Messaging → Web Push certificates**. Set `PUBLIC_FIREBASE_VAPID_KEY`; never substitute a private service-account key.
4. Register the Android app using the exact `ANDROID_APP_ID`. Download its `google-services.json` and supply it as `ANDROID_GOOGLE_SERVICES_JSON` in the build environment. Register the relevant debug/upload/Play app-signing certificate fingerprints as required by the identity flow. The Play app-signing certificate is not necessarily the upload certificate.
5. For trusted FCM sends only, obtain a dedicated service-account JSON from **Project settings → Service accounts** if your approved credential strategy requires a JSON key. Store it as `FIREBASE_SERVICE_ACCOUNT_JSON` in the server secret store; use the matching `FIREBASE_PROJECT_ID`. Limit permissions and rotate/revoke keys when needed.
6. For SMS, separately configure the provider, authorized domains, Android protections, billing approval, region restrictions and abuse controls. Public/server flags and SQL admission must all agree. A daily application counter or budget alert is **not** a guaranteed billing cap. Use staff confirmation when SMS is unavailable.

The current notification/phone implementations still have legacy Supabase dependencies. Setting `ENABLE_SMS`, `ENABLE_NOTIFICATIONS`, or supplying keys does not complete their Neon migration. Do not activate them until the coordinator verifies the migrated routes.

Official references: [Firebase project configuration](https://firebase.google.com/docs/web/setup), [Android phone authentication](https://firebase.google.com/docs/auth/android/phone-auth), [FCM web setup](https://firebase.google.com/docs/cloud-messaging/web/get-started), [FCM server environment](https://firebase.google.com/docs/cloud-messaging/server-environment).

## 3. Optional Brevo email and worker authentication

1. In Brevo's account settings, open **SMTP & API → API Keys**, create a key for this application, and store it as `BREVO_API_KEY` server-side. An SMTP password is not an HTTP API key.
2. Register and verify the sender/domain in **Senders & domains**. Complete the DNS verification records provided by Brevo without replacing unrelated mail records.
3. Set `MAIL_FROM_EMAIL` to the verified sender and `MAIL_FROM_NAME` to the shop's display name.
4. Generate a random worker secret locally, for example using `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` in your own terminal. Put that value in the worker and authorized scheduler secret stores as `NOTIFICATION_WORKER_SECRET`. Do not paste the output into this document or chat.
5. Leave `ENABLE_NOTIFICATIONS=false` until worker authentication, rate/recipient quotas, idempotency, and delivery-result recording pass tests. No test should email real customers merely because credentials exist.

References: [Brevo sender/domain setup](https://developers.brevo.com/docs/getting-started-with-senders-and-domains), [transactional email](https://developers.brevo.com/docs/send-a-transactional-email).

## 4. Android build and upload signing

- `JAVA_HOME`: local JDK 21 installation. `ANDROID_HOME` or `ANDROID_SDK_ROOT`: installed Android SDK, including platform 36 and required build tools. These are paths, not credentials.
- `ANDROID_APP_ID`: stable application identity; use the same identity in Firebase and Play Console.
- `ANDROID_VERSION_CODE` and `ANDROID_VERSION_NAME`: planned release numbers. Codes must increase for new Play uploads.
- Create or select an **upload keystore** using Android Studio's signed App Bundle workflow. Keep it outside the repository and back it up securely.
- `ANDROID_KEYSTORE_PATH`: absolute external path used by the build. `ANDROID_KEYSTORE_BASE64`: CI transport form of that same file; Base64 is not encryption. The protected workflow materializes a file outside the checkout. Do not configure both alternatives for the same readiness check.
- `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`: passwords chosen when generating the key. `ANDROID_KEY_ALIAS`: selected alias. Store passwords as environment secrets, not shell command arguments or Gradle properties committed to Git.
- `ANDROID_UPLOAD_CERT_SHA256`: inspect with `keytool -list -v -keystore <external-path>` and enter the password interactively. This is the public upload certificate fingerprint, not proof the generated bundle is signed correctly.

Current limitation: the signing gate validates fingerprint format but does not yet compare the actual keystore/output certificate. Also, current `prepare-android.mjs` removes `android/app/google-services.json` if the explicit JSON input is absent. Preserve existing local files before running that script; coordinator review is required.

Official reference: [Android app signing](https://developer.android.com/studio/publish/app-signing).

## 5. Play publishing and GitHub gates

The current `publish-play.mjs` deliberately fails with `PLAY_UPLOAD_NOT_IMPLEMENTED`. Do not obtain broad credentials expecting that to repair missing code.

For the eventual supported upload flow, enable the Android Publisher API in the intended Google Cloud project, create a dedicated service account, and grant it only the necessary app/release permissions through Play Console's user/permission controls. If using a JSON key, store it as `PLAY_SERVICE_ACCOUNT_JSON` in protected CI, or `PLAY_SERVICE_ACCOUNT_FILE` as an absolute path outside the checkout—not both. Keep financial/admin permissions out of an upload-only account. Complete first-app Console setup, signing enrollment, disclosures and any account testing/production gates.

Create the GitHub **`android-release`** environment with required reviewers and branch restrictions. Put secrets under that environment; put nonsecret build settings and these attestation variables under its Variables:

- `RELEASES_ENABLED`, `RELEASE_ENVIRONMENT_CONFIGURED`
- `RELEASE_PRIVACY_APPROVED`, `RELEASE_DATA_SAFETY_APPROVED`
- `RELEASE_DELETION_APPROVED`, `RELEASE_CONTACT_APPROVED`
- `RELEASE_DEVICE_TESTED`, `RELEASE_BACKUP_RESTORE_TESTED`
- `RELEASE_SMS_BILLING_ACK` only when SMS is approved

Defaults are false. These flags record existing evidence; they are not a checklist to blindly set true. `RELEASE_APPROVED`, `RELEASE_APPROVED_SHA`, `GITHUB_*`, and the temporary `KEY_BASE64` alias are workflow-derived. Do not manually spoof them. Future `PLAY_UPLOAD_APPROVED` and `PLAY_CONSOLE_BOOTSTRAPPED` require actual approval/setup; the currently supported target declaration is `PLAY_TRACK=internal`, `PLAY_RELEASE_STATUS=draft`. A submitted draft is not Play approval.

References: [Android Publisher setup](https://developers.google.com/android-publisher/getting_started), [GitHub environment secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions).

## Migration reconciliation still required

At this inventory's inspection point:

- Public catalog and release configuration now use `PUBLIC_NEON_AUTH_URL` and `PUBLIC_COMMERCE_API_URL`. Do not supply Supabase credentials to these fields.
- Legacy Edge code still consumes `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. These must not be used as Neon runtime credentials.
- The Neon web client is implemented locally. Native Google login and live session compatibility remain unverified; configured URLs alone do not complete those flows.
- Current server requires the restricted `COMMERCE_DATABASE_URL`, fixed Neon auth URLs, S3 configuration, allowlisted origins and Google-only policy confirmation. `neon.ts` must explicitly deliver the custom values it consumes.
- Admin Telegram alerts use `COMMERCE_WORKER_DATABASE_URL`, granted only `commerce_worker`, and `NOTIFICATION_WORKER_SECRET`. The local worker and transport require deployment, an authenticated scheduler, and live delivery verification. SMS/push and production frontend hosting remain incomplete.

No secret values were inspected to prepare this document. Credential acquisition/configuration and actual end-to-end tests remain separate from this inventory.

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
