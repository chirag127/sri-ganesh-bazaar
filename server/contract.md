# Neon HTTP contract

The default export in server/index.mjs is a Neon Functions fetch handler.

- GET /health: process health only; not proof of database connectivity.
- GET /catalog: public catalog_snapshot result; excludes unit prices, purchase costs and exact stock counts. Fixed-unit metadata and availability remain public.
- POST /rpc/:name: JSON named SQL arguments, raw JSON SQL result. Allowed names are customer_workspace, admin_workspace, commerce_command, commerce_page, customer_orders, customer_order_detail, admin_order_detail, admin_customer_detail, cart_estimate, estimate_settings_command, product_request_command, product_requests_page, owner_analytics. No arbitrary SQL/function names.
- POST /evidence/upload?order_id=<uuid>: raw PNG/JPEG/WebP bytes, at most 2 MiB; returns {path} after private upload and metadata registration.
- POST /evidence/url: JSON {path}; authorized owner/admin download returns {url}, expires after 60 seconds.
- POST /rpc/cart_estimate: {p_lines:[{variant_id,quantity}],p_fulfillment}. Requires an authenticated, shop-approved customer. Returns approximate goods and delivery-range totals; never reserves stock. Unconfigured delivery totals are null, not zero.
- POST /rpc/estimate_settings_command: {p_action,p_payload}. Admin-only approval/revocation and delivery-range updates; payload requires request_id.
- POST /rpc/product_request_command: {p_action,p_payload}. Customers create private product requests; admins mark them pending/resolved. Payload requires request_id. Requests never create orders, reservations or financial postings.
- POST /rpc/product_requests_page: {p_admin,p_limit,p_offset}. Customer reads are restricted to their own requests; admin reads require server authorization.
- POST /rpc/owner_analytics: {p_from,p_to}, inclusive ISO dates spanning at most 366 days. Admin-only aggregate counts distinguish enquiries, current accepted-order states, issued bills, pending requests and current low stock; no customer identities or external AI calls.
- Phone, notifications and all unimplemented routes fail closed; no simulated success.

All protected requests require Bearer Neon Auth JWT and verified email. Configure Managed Auth Google-only, then set NEON_GOOGLE_ONLY_CONFIRMED=true after checking the provider policy. This is a deployment gate, not proof of provider identity by itself; do not enable it on an Auth project allowing other providers.

Each protected operation obtains one pg connection, begins a transaction, invokes commerce_identity.begin_request(subject,email,name,email_verified), invokes allowlisted RPCs, then commits. Subject/profile derive from a verified JWT, never the body. commerce_runtime membership is mandatory; superuser, bypass-RLS and worker credentials are rejected. COMMERCE_DATABASE_URL must be a dedicated runtime login with only commerce_runtime membership. Never use the injected database owner URL. Owner-role membership must also be excluded during provisioning.

Server environment: COMMERCE_DATABASE_URL, NEON_AUTH_BASE_URL, NEON_AUTH_JWKS_URL, NEON_GOOGLE_ONLY_CONFIRMED, ALLOWED_ORIGINS (comma-separated exact web/native origins), AWS_ENDPOINT_URL_S3, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY. PAYMENT_EVIDENCE_BUCKET defaults to private assets. No credentials may be exposed through PUBLIC_ variables.

Dependencies: pg, @neon/functions, jose, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner. Raw AWS SDK is used for conditional non-overwriting uploads and explicit retry control. Request bodies are bounded even without Content-Length. Errors never return raw database/provider details. Storage and SQL are not a distributed transaction: failed/ambiguous metadata writes may leave orphan files; do not delete on ambiguous commit. Reconciled retention cleanup remains an operational requirement.

## Admin alert worker

`server/admin-alert-entry.mjs` exports a separate scheduler-only fetch handler. It accepts an empty POST with `Authorization: Bearer <NOTIFICATION_WORKER_SECRET>`, rejects browser Origin headers, and initializes the worker only after authentication. It is not a customer RPC endpoint.

Required worker settings: `ENABLE_TELEGRAM_ALERTS=true`, `COMMERCE_WORKER_DATABASE_URL`, `NOTIFICATION_WORKER_SECRET`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_ADMIN_CHAT_ID`. The database login must inherit only `commerce_worker` and pass the ownership checks. Never substitute the owner or commerce-runtime database URL.

Each invocation processes at most one queued event. Transactional triggers enqueue generic enquiry, quote-acceptance, payment-submission and low-stock events. Expired leases and ambiguous sends become uncertain rather than being automatically replayed. Explicit rate-limit retries are bounded and paced. Alert bodies omit customer details and prices.

The function declaration is conditional on alert enablement. Declaring it does not configure an authenticated scheduler or prove delivery. Keep enablement off until provisioning, scheduler authentication, role isolation and an authorized delivery test are verified.

Tests use injected dependencies and do not establish live Neon, Google OAuth, S3, Telegram, or deployed-role behavior.
