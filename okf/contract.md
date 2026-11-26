# Integration contract

This is the authoritative first-release boundary shared by implementation agents.
The user approved code implementation and a feature-branch PR, not live account
creation, billing activation, DNS mutation, or Play submission.

## Architecture

- Astro static HTML + React islands: public SEO pages and `/app/` customer UI,
  `/admin/` admin UI. Both share responsive design tokens and the Neon Auth/API client.
- Capacitor bundles the same static output locally; no remote website-only shell.
- Neon PostgreSQL owns transactions, stock, quotes, accounts and ledger; the trusted
  commerce API binds verified identity to each database transaction.
- Neon Auth provides Google OAuth on web. Native Google login remains unverified
  and must not be represented as working by Android target configuration alone.
  Optional phone verification never authorizes merging customer histories.
- Cloudflare Pages static hosting; GitHub standard Ubuntu CI; signed Android/Play
  jobs opt in only after secrets, Console bootstrap, and release approval.
- No real secret in repository, browser bundle, Android assets, or Actions output.

## Frozen product decisions

Pashu Saathi at vikas.oriz.in, operated by Shri Ganesh Trading Company, focuses on
cattle feed and wholesale fixed packs. English with a Hindi toggle is the requested
interface; full language switching remains pending. Public catalog responses and
pages omit prices. Only shop-approved customers may request authenticated,
server-calculated approximate totals. Quotes and bills retain private prices.
All online purchases remain enquiry-first, with Google login and phone contact.
Phone states distinguish unverified, SMS-verified and staff-confirmed. No always-free
SMS or uptime guarantee. The current 50-product snapshot bound is an implementation
limit, not a business requirement or a claim of unlimited capacity.

Only fixed bags, jars, bottles, pieces and packs; no loose or fractional sales.
Each variant has a fixed unit kind, optional physical kilogram weight, positive
integer sale quantities and a private stored unit price in INR paise. Preserve used
variant identity and historical labels. Exact stock and purchase cost stay private;
no supplier purchasing module.
Counter sales may use staff-created customer records without Google login.
Google account linking must be explicit and authorized; never merge by phone alone.

One physical shop. Pickup, customer-arranged driver, shop-arranged tempo/e-rickshaw.
Shop collects quoted transport charges. Cash collector chosen per order (shop or
assigned driver); confirmation must record actual receipt/remittance, not trust a
customer screenshot. No traditional courier integration.

Quotes expire after 48 hours. Accepted quotes reserve stock atomically. Required
deposit and its reservation deadline are specified in each quote. Unpaid expired
holds release stock. Revise a quote before accepting changed items/quantities;
no silent substitutions/partial fulfillment. In-app or recorded call/WhatsApp
acceptance allowed, with staff actor and evidence note.

Cash and manually verified UPI, reference + optional private screenshot. Advances
and dues mean a shop ledger, not transferable stored money. Credit requires staff
approval for each sale. Staff-approved returns and refunds must preserve an audit
trail. Bills/receipts use a separate app series. No GST calculation, GST invoice,
IRN, or statement that products are legally exempt.

Several full admins. Any admin can appoint/remove other admins, but the last admin
cannot be removed. First admin is bootstrapped out of band by the owner. Customer
view is default; admin switch is available only after server role confirmation.

Offline saves only public catalog/cart; protected histories/payment screenshots
must not enter public/service-worker caches. Quota outage degrades to catalog +
contact, not falsely confirmed writes. Images bounded and compressed. Automatic
dependency updates open review PRs; no blind auto-merge.

## Frontend module contracts (coordinator owns src/lib)

`src/lib/types.ts` exports Product, Variant, Customer, Quote, Order, LedgerEntry,
InventoryRow, Bill, Workspace, AdminWorkspace, CartLine and CommandName.
`src/lib/api.ts` exports `getCatalog()`, `getWorkspace()`, `getAdminWorkspace()`,
`command(name, payload)`, `getClient()`, `isConfigured`, `subscribeAuth(callback)`.
All async calls throw user-facing Errors on failure; no local fake persistence.
`src/lib/auth.ts` exports `signInGoogle()`, `signOut()`, `requestSms(phone)`,
`confirmSms(code)`, `requestPush()`. SMS is optional, disabled by default.
`src/lib/format.ts` exports `money(paise)`, `formatDate(iso)`, `parseMoney(text)`.
`src/lib/cart.ts` exports `loadCart()`, `saveCart(lines)`, `addToCart(variantId,qty)`;
only public variant IDs/positive integer quantities in local storage; catch every
storage access. `src/data/catalog.ts` exports `sampleCatalog` for visibly labeled
illustrative unconfigured builds. Never label sample items as actual shop stock.

Client components:
- `src/components/CustomerApp.tsx` default export, no required props.
- `src/components/AdminApp.tsx` default export, no required props.
- Public-layout author embeds these on `/app/` and `/admin/` with `client:only="react"`.
- Auth/native agent owns src/lib/auth.ts and src/lib/notifications.ts only.
- Admin UI author owns AdminApp.tsx and admin.css only; never common styles.

## Database API contract

Public RPC `catalog_snapshot()` -> `{ products: Product[], configured: true }`.
Authenticated RPC `customer_workspace()` -> Workspace.
Admin-only RPC `admin_workspace()` -> AdminWorkspace; bounded to latest 200 orders,
200 customers, 200 ledger entries, and explicit pagination/search RPC if needed.
Authenticated RPC `commerce_command(p_action text, p_payload jsonb)` -> JSON.
It is a dispatcher into transactional, authorization-checked operations below.
No clients write tables directly. PostgreSQL RPC failures rollback the whole action.
Client idempotency keys are UUID `request_id`; successful commands return an ID.

Canonical pagination RPC: `commerce_page(p_entity text,p_search text default '',
p_limit integer default 50,p_offset integer default 0)` -> `{items,total,offset,limit}`.
Entities are `orders`, `customers`, `ledger`, `bills`, and `submissions`. Customer
calls are restricted to their own records; customer-directory access is admin-only.
`admin_customer_detail(p_customer_id uuid)` -> CustomerDetail;
`admin_order_detail(p_order_id uuid)` -> OrderDetail;
`customer_orders(p_offset integer,p_limit integer)` -> Page<Order>;
`customer_order_detail(p_order_id uuid)` -> OrderDetail.
Details include authoritative balances and bounded related-record collections.
These names supersede discussion-only proposals such as `admin_search`.

Types use snake_case matching JSON/database field names:
- Product: id, slug, name, category, description, image_url (nullable), active,
  variants: Variant[]. Public catalog contains published active products only.
- Public Variant: id, product_id, label (e.g. 50 kg bag), unit_kind, nullable
  weight_kg, available (boolean). Public responses omit all prices, purchase costs
  and exact inventory. AdminVariant additionally contains reference_price_paise.
- Customer: id, auth_user_id|null, name, phone|null, phone_status
  (`unverified|sms_verified|staff_confirmed`), email|null, address|null,
  created_at. Staff-created customers have no public history until approved link.
- Quote: id, version, lines: [{variant_id,label,quantity,unit_price_paise}],
  goods_total_paise, transport_paise, total_paise, deposit_paise, expires_at,
  reservation_until, notes, credit_approved (boolean).
- Order: id, number, customer_id, customer_name?, status
  (`enquiry|quoted|accepted|ready|dispatched|completed|cancelled`),
  fulfillment (`pickup|own_driver|shop_delivery`), address|null, notes|null,
  lines: [{variant_id,label,quantity}], quote: Quote|null, paid_paise,
  cash_collector (`shop|driver`), driver_name|null, driver_phone|null,
  created_at, updated_at. Revision must be verified at acceptance with quote_id.
- LedgerEntry: id, customer_id, order_id|null, kind, amount_paise (positive means
  customer owes more, negative means shop owes/has received money), note,
  created_at. Ledger is append-only; corrections are linked reversing entries.
- InventoryRow: variant_id, product_name, label, on_hand, reserved, available,
  average_cost_paise, reorder_level, selling_paused. This record is admin-only.
- Bill: id, number, order_id, customer_id, issued_at, total_paise, lines,
  transport_paise. Server-derived immutable bill, no tax fields.
- Workspace: customer: Customer, orders: Order[], ledger: LedgerEntry[], bills:
  Bill[], is_admin: boolean, phone_requests?: array, balance_paise: number.
- AdminWorkspace: customers: Customer[], orders: Order[], inventory:
  InventoryRow[], ledger: LedgerEntry[], bills: Bill[], admins: [{user_id,email}],
  products: Product[], audit?: array.

Customer actions (all require authenticated Google account; profile creation is
idempotent at first workspace read):
- `save_profile`: {name,phone,address}; changing phone clears phone verification.
- `submit_enquiry`: {lines:[{variant_id,quantity}],fulfillment,address,notes};
  requires phone contact, nonempty lines, bounded quantities, active SKUs.
- `accept_quote`: {order_id,quote_id}; ownership, nonexpired current version and
  enough stock rechecked under locks; reserves all or nothing.
- `submit_payment`: {order_id,amount_paise,reference,screenshot_path?}; evidence
  only, never increases paid amount or ledger balance until staff verifies it.
- `cancel_order`: {order_id,reason}; only pre-dispatch, releases holds, creates
  any required refund action without silently erasing receipt history.
- `request_account_deletion`: {reason?}; durable request and visible processing
  status; staff process personal data with necessary bill retention documented.

Admin actions (server-enforced, audit every successful change):
- `save_product`: {id?,name,slug,category,description,image_url?,active,
  variants:[{id?,label,unit_kind,weight_kg,reference_price_paise}]}; safe edit/deactivate,
  no deletion of referenced variants/history.
- `adjust_stock`: {variant_id,quantity_delta,unit_cost_paise?,reason}; incoming
  requires cost; no negative on-hand/available; weighted average, audit movements.
- `count_stock`: {variant_id,expected_on_hand,counted_on_hand,reason}; rejects stale
  counts and counts below reservations; preserves valuation and audits corrections.
- `set_stock_availability`: {variant_id,available,reason}; pauses new sales without
  hiding published listings or discarding accepted-order reservations.
- `set_reorder_level`: {variant_id,reorder_level}; owner-controlled nonnegative
  integer threshold. Threshold storage alone does not deliver notifications.
- `create_customer`: {name,phone,address?,opening_balance_paise?,note?}.
- `link_customer`: {customer_id,user_email,note}; explicit admin reviewed account
  link; prevent stealing an account or merging nonempty ledgers implicitly.
- `confirm_phone`: {customer_id,note}; staff-confirmed, not SMS-verified.
- `issue_quote`: {order_id,lines:[{variant_id,quantity,unit_price_paise}],
  transport_paise,deposit_paise,reservation_until,notes,credit_approved};
  48h expiry, versioned; reject unsafe revisions after goods release.
- `accept_quote_for_customer`: {order_id,quote_id,note}; same transactional checks
  as customer acceptance, audit customer's phone/WhatsApp consent.
- `record_payment`: {customer_id,order_id?,amount_paise,method:`cash|upi`,reference?,
  note,payment_submission_id?,received_by:`shop|driver`,bank_verified?,verification_note?};
  UPI requires bank_verified:true and a verification_note based on the actual bank
  record. Positive receipt records a negative ledger entry. Driver receipts remain
  pending remittance. Validate overpayment as advance, not lost money.
- `record_remittance`: {payment_id,amount_paise,note}; records money passed from the
  assigned driver to the shop without crediting the customer ledger a second time.
- `set_fulfillment`: {order_id,fulfillment,address?,cash_collector,driver_name?,
  driver_phone?}; collector choice is not payment confirmation.
- `advance_order`: {order_id,status,handover_note?,cod_approved?}; only allowed state
  transitions; dispatch or pickup completion consumes reserved inventory and posts
  one bill/debit. Unpaid release requires quote.credit_approved and handover evidence,
  or explicit COD approval with an assigned named driver. COD is a collectible,
  never a paid receipt. Repeated transitions must not repost inventory or money.
- `counter_sale`: {customer_id,lines:[{variant_id,quantity,unit_price_paise}],
  paid_paise,method,reference?,credit_approved,note,bank_verified?,verification_note?};
  transactional immediate sale, stock decrease, bill, receipt, and credit checks.
  UPI requires bank_verified:true plus verification_note. Credit requires a note.
- `record_return`: {order_id,lines:[{variant_id,quantity,restock:boolean}],
  amount_paise,note}; only sold quantities not already returned, bounded refund
  value, linked reversal/bill adjustment; no deleting prior financial entries.
- `record_refund`: {customer_id,order_id?,amount_paise,method,reference?,note};
  only available customer credit; linked positive ledger entry, explicit receipt.
- `set_admin`: {email,enabled}; authenticated existing user, cannot remove last.
- `process_account_deletion`: {deletion_request_id,status:`processing|completed|rejected`,note};
  audited processing. Completed requests redact the profile while preserving required
  financial records; authentication-account deletion is a separate operational gate.
- `expire_reservations`: {}; releases expired unpaid holds transactionally.

Workspaces additionally expose payment_submissions, receipts, deletion_requests,
returns, refund_requests, driver_collections, and pagination metadata. Customer
balance_paise is computed server-side, never by summing a truncated ledger slice.
Receipts include payment_id and received_by (`shop|driver`). Driver collections
include payment_id, amount_paise, remitted_paise and pending/partial/remitted status.
The shared src/lib/types.ts describes these JSON objects.

Private payment evidence uses the server-only `PAYMENT_EVIDENCE_BUCKET` setting
(default `assets`), path `<internal-user-uuid>/<order-uuid>/<random-uuid>.(jpg|jpeg|png|webp)`,
maximum 2 MiB. The commerce API authorizes uploads and signed reads through database
ownership/admin checks; the bucket must remain private. Screenshots are not proof
that payment arrived and must never be in the offline cache.

Phone helpers: phone_start(p_phone) binds authenticated user/current phone and returns
{challenge_id,allowed,reason,expires_at}; phone_challenge(p_challenge_id) is service-only;
phone_complete(p_challenge_id,p_user_id,p_phone,p_firebase_uid) is service-only and
checks current phone, expiry and single use. The Edge handler checks ENABLE_SMS before
admission; the database has its own disabled-by-default admission setting.
Push commands: register_push/unregister_push use installation_id plus token and
platform; unregister must match the authenticated subject and installation.
notification_claim(p_limit) and notification_finish(p_job_id,p_state,p_provider_id,p_error)
are service-only. Each push job targets one installation. Ambiguous external delivery
becomes `uncertain`, not a blind resend. No secret role may enter either client.

## Visual and interaction contract

Warm cream background, deep brown ink, forest green primary action, muted saffron
accent; serif headings plus system sans body, generous readable mobile spacing.
CSS token names: --bg, --surface, --surface-alt, --text, --muted, --primary,
--primary-contrast, --accent, --border, --danger, --radius, --shadow.
Explicit light/dark tokens, 16px mobile gutters, no page overflow, focus states,
labels, 44px targets, loading/error/empty states. Stats use labeled numbers, not
unvalidated decorative charts. Exact labels and units for stock and money.

Public pages need stable product URLs, truthful metadata/canonical, sitemap,
robots, privacy, deletion-request help, contact setup placeholders. Structured
Product/Offer data only when real owner-provided prices exist; no fake ratings.
Do not expose administrative, stock-cost, customer or wallet data in static HTML.
