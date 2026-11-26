import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { loadMigrations, HISTORY_TRUST } from '../../scripts/migrate-database.mjs';

// Default: node --test tests/postgres/concurrency.spec.mjs
// Live: explicitly inject TEST_DATABASE_URL (direct owner LOGIN, not a pooler) and
// TEST_DATABASE_BRANCH_OPT_IN=isolated-verification-branch, then run the same command.
// The opt-in attests this is an EXCLUSIVE disposable verification branch, with no
// application/worker attached. SQL cannot prove a provider's branch identity.
// Apply scripts/migrate-database.mjs separately first; this test does not migrate.
// Committed synthetic records (including immutable quotes/movements and queued
// notifications) REMAIN, even on failure. No DELETE/TRUNCATE, trigger disabling,
// DROP OWNED, or schema drops: dispose of the branch separately after inspection.
// A rerun refuses those records. A killed process may also leave its temporary
// LOGIN; it expires after 15 minutes. Cleanup only drops the exact marked role
// created here, never preexisting roles; dependencies make DROP ROLE fail closed.
// There is no dotenv, URL fallback, provider SDK, or external notification call.
const OPT_IN = 'isolated-verification-branch';
const SCHEMAS = ['public', 'commerce_identity', 'commerce_private'];
const ident = value => '"' + value.replaceAll('"', '""') + '"';
const literal = value => "'" + value.replaceAll("'", "''") + "'";

function configuration(env) {
  if (!env.TEST_DATABASE_URL?.trim() || env.TEST_DATABASE_BRANCH_OPT_IN !== OPT_IN) return null;
  let url;
  try { url = new URL(env.TEST_DATABASE_URL); } catch { throw new Error('Invalid explicit test URL'); }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL URL required');
  assert.ok(url.hostname && url.username && url.password && url.pathname.length > 1, 'Explicit host, database and password LOGIN required');
  assert.ok(!url.hostname.includes('-pooler'), 'Direct connection required');
  assert.equal(url.hash, '', 'URL fragments are not allowed');
  assert.ok([...url.searchParams.keys()].every(key => key === 'sslmode'), 'Only sslmode is allowed in the URL query');
  assert.ok(url.searchParams.getAll('sslmode').length <= 1, 'Duplicate sslmode');
  const sslmode = url.searchParams.get('sslmode') ?? 'verify-full';
  assert.ok(['require', 'verify-full', 'disable'].includes(sslmode), 'Unsupported sslmode');
  assert.ok(sslmode !== 'disable' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'TLS required outside loopback');
  try {
    return {
      host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 5432),
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
      // Do not let connection-string options override credentials or timeouts.
      ssl: sslmode === 'disable' ? false : { rejectUnauthorized: true },
      options: '-c search_path=pg_catalog,public', application_name: 'postgres-concurrency-test',
      connectionTimeoutMillis: 10000, statement_timeout: 20000, lock_timeout: 15000,
      idle_in_transaction_session_timeout: 30000, query_timeout: 25000,
    };
  } catch { throw new Error('Invalid explicit test URL encoding'); }
}

async function requireEmpty(client) {
  const tables = (await client.query(`select n.nspname, c.relname,
    c.relowner = (select oid from pg_roles where rolname = current_user) as owned
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname=any($1::text[]) and c.relkind in ('r','p','f')
    order by n.nspname,c.relname`, [SCHEMAS])).rows;
  assert.ok(tables.length >= 30, 'Complete commerce schema required');
  assert.ok(tables.every(table => table.owned), 'Refusing tables not owned by the explicit test LOGIN');
  // Lock before checking emptiness, not after: never seed alongside another writer.
  await client.query(`LOCK TABLE ${tables.map(t => `${ident(t.nspname)}.${ident(t.relname)}`).join(',')} IN ACCESS EXCLUSIVE MODE NOWAIT`);
  for (const table of tables) {
    const name = `${table.nspname}.${table.relname}`;
    // These are migration-created singleton configuration rows, not business data.
    if (['commerce_private.server_settings', 'commerce_private.admin_alert_pacing'].includes(name)) continue;
    const { rows } = await client.query(`select exists(select 1 from ${ident(table.nspname)}.${ident(table.relname)}) as populated`);
    assert.equal(rows[0].populated, false, 'Refusing nonempty commerce tables; use a fresh schema-only branch');
  }
  const settings = (await client.query('select * from commerce_private.server_settings')).rows;
  assert.equal(settings.length, 1, 'Expected migration singleton');
  assert.equal(settings[0].sms_enabled, false);
  assert.equal(settings[0].email_enabled, false);
  assert.equal(settings[0].push_enabled, false);
  assert.equal((await client.query('select count(*)::int n from commerce_private.admin_alert_pacing')).rows[0].n, 1);
}

async function seed(client) {
  const variant = randomUUID(), product = randomUUID();
  const buyers = [0, 1].map(() => ({ user: randomUUID(), customer: randomUUID(), order: randomUUID(), quote: randomUUID(), request: randomUUID(), subject: `synthetic-concurrency-${randomUUID()}` }));
  await client.query(`insert into public.products(id,slug,name,category,description,active)
    values($1,$2,'Synthetic concurrency fixture','Test','Not shop inventory',true)`, [product, `synthetic-${product}`]);
  await client.query(`insert into public.variants(id,product_id,label,unit_kind,weight_kg,reference_price_paise)
    values($1,$2,'Synthetic fixed pack','pack',null,100)`, [variant, product]);
  await client.query('insert into public.inventory(variant_id,on_hand,reserved) values($1,1,0)', [variant]);
  for (const buyer of buyers) {
    await client.query(`insert into commerce_identity.users(id,external_subject,email)
      values($1,$2,$3)`, [buyer.user, buyer.subject, `${buyer.subject}@example.invalid`]);
    await client.query(`insert into public.customers(id,auth_user_id,name) values($1,$2,'Synthetic test customer')`, [buyer.customer, buyer.user]);
    const lines = JSON.stringify([{ variant_id: variant, label: 'Synthetic fixed pack', quantity: 1, unit_price_paise: 100 }]);
    await client.query(`insert into public.orders(id,number,customer_id,status,fulfillment,lines,notes)
      values($1,$2,$3,'quoted','pickup',$4::jsonb,'Synthetic concurrency fixture')`, [buyer.order, `TEST-${buyer.order}`, buyer.customer, lines]);
    await client.query(`insert into public.quotes(id,order_id,version,lines,goods_total_paise,transport_paise,total_paise,deposit_paise,expires_at,reservation_until,created_by,notes)
      values($1,$2,1,$3::jsonb,100,0,100,0,now()+interval '48 hours',now()+interval '1 hour',$4,'Synthetic concurrency fixture')`, [buyer.quote, buyer.order, lines, buyer.user]);
    await client.query('update public.orders set current_quote_id=$2 where id=$1', [buyer.order, buyer.quote]);
  }
  return { variant, buyers };
}

async function invariant(owner, variant, expected) {
  const row = (await owner.query(`select i.on_hand,i.reserved,
    coalesce((select sum(r.quantity)::int from public.reservations r where r.variant_id=i.variant_id),0) as holds
    from public.inventory i where i.variant_id=$1`, [variant])).rows[0];
  assert.equal(row.on_hand, 1, 'Acceptance must not consume physical stock');
  assert.ok(row.reserved >= 0 && row.reserved <= row.on_hand);
  assert.equal(row.holds, row.reserved, 'Reservation rows must reconcile to inventory');
  if (expected !== undefined) assert.equal(row.reserved, expected);
}

async function accept(client, buyer) {
  try {
    const result = (await client.query(`select public.commerce_command('accept_quote',$1::jsonb) as result`, [JSON.stringify({ request_id: buyer.request, order_id: buyer.order, quote_id: buyer.quote })])).rows[0].result;
    await client.query('COMMIT');
    return { ok: true, result };
  } catch (error) {
    await client.query('ROLLBACK');
    // Do not return SQL/provider diagnostics or mistake any error for sold out.
    return { ok: false, insufficient: error.code === 'P0001' && error.message === 'Insufficient stock for the complete quote' };
  }
}

async function runLive(config, t) {
  const { Client } = await import('pg');
  const clients = [];
  function make(overrides = {}) {
    const client = new Client({ ...config, ...overrides });
    // Idle socket failures must not become unhandled EventEmitter errors.
    client.on('error', () => {});
    clients.push(client);
    return client;
  }
  const owner = make();
  const role = `pashu_test_${randomBytes(12).toString('hex')}`;
  const password = randomBytes(32).toString('hex');
  const marker = `synthetic-concurrency-${randomUUID()}`;
  let roleOid, roleCommitted = false, pending = [], failure, cleanupFailed = false;
  try {
    await owner.connect();
    assert.equal((await owner.query('select current_user=session_user as direct')).rows[0].direct, true);
    assert.equal((await owner.query(HISTORY_TRUST)).rows[0].trusted, true, 'Trusted owner migration history required');
    const migrations = await loadMigrations();
    const history = (await owner.query('select position,name,checksum from commerce_migrations.history order by position')).rows;
    assert.deepEqual(history, migrations.map((m, i) => ({ position: i + 1, name: m.name, checksum: m.checksum })), 'Apply the exact migration chain separately first');
    await owner.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await requireEmpty(owner);
    const fixture = await seed(owner);
    // CREATE ROLE has no owner column. Record its OID plus an unguessable comment
    // inside the same transaction as creation; use both to establish provenance.
    await owner.query(`CREATE ROLE ${ident(role)} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD ${literal(password)} VALID UNTIL ${literal(new Date(Date.now() + 900000).toISOString())}`);
    await owner.query(`GRANT commerce_runtime TO ${ident(role)}`);
    await owner.query(`COMMENT ON ROLE ${ident(role)} IS ${literal(marker)}`);
    roleOid = (await owner.query('select oid from pg_roles where rolname=$1', [role])).rows[0].oid;
    await owner.query('COMMIT');
    roleCommitted = true;
    t.diagnostic('Synthetic records are retained; dispose of this verification branch separately.');

    const peers = [make({ user: role, password }), make({ user: role, password })];
    for (let i = 0; i < peers.length; i++) {
      await peers[i].connect();
      const identity = (await peers[i].query(`select session_user,current_user,pg_backend_pid() as pid,
        rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=session_user`)).rows[0];
      assert.equal(identity.session_user, role);
      assert.equal(identity.current_user, role);
      for (const flag of ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls']) assert.equal(identity[flag], false);
      const membership = (await peers[i].query(`select rolname from pg_roles where rolname<>session_user and pg_has_role(session_user,oid,'MEMBER') order by rolname`)).rows.map(row => row.rolname);
      assert.deepEqual(membership, ['commerce_runtime'], 'Runtime LOGIN must have no owner/worker/other role membership');
      fixture.buyers[i].pid = identity.pid;
      await peers[i].query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await peers[i].query('select commerce_identity.begin_request($1,$2,$3,true)', [fixture.buyers[i].subject, `${fixture.buyers[i].subject}@example.invalid`, 'Synthetic test customer']);
    }
    assert.notEqual(fixture.buyers[0].pid, fixture.buyers[1].pid, 'Independent backend connections required');
    await invariant(owner, fixture.variant, 0);
    // This is the production mutation lock. Hold it until BOTH independent RPCs
    // are observed waiting inside PostgreSQL, rather than relying on Promise.all
    // scheduling or a sleep to claim that the calls actually overlap.
    await owner.query('select pg_advisory_lock(741821,1)');
    pending = peers.map((peer, i) => accept(peer, fixture.buyers[i]).then(async result => {
      await invariant(owner, fixture.variant);
      return result;
    }));
    // Attach rejection handlers immediately, including the barrier-failure path.
    const settled = Promise.allSettled(pending);
    const deadline = Date.now() + 8000;
    let blocked = false;
    while (Date.now() < deadline) {
      const rows = (await owner.query(`select pid,pg_backend_pid()=any(pg_blocking_pids(pid)) as blocked
        from unnest($1::int[]) pid`, [fixture.buyers.map(buyer => buyer.pid)])).rows;
      if (rows.length === 2 && rows.every(row => row.blocked)) { blocked = true; break; }
      await delay(25);
    }
    assert.equal(blocked, true, 'Both accept RPCs must reach the PostgreSQL lock barrier');
    await owner.query('select pg_advisory_unlock(741821,1)');
    const completed = await settled;
    assert.ok(completed.every(item => item.status === 'fulfilled'), 'All requests and invariant observations must finish');
    const results = completed.map(item => item.value);
    assert.equal(results.filter(result => result.ok).length, 1, 'Exactly one acceptance must commit');
    assert.equal(results.filter(result => !result.ok && result.insufficient).length, 1, 'Other acceptance must fail specifically for insufficient stock');
    const winner = results.findIndex(result => result.ok);
    assert.equal(results[winner].result.id, fixture.buyers[winner].order);
    await invariant(owner, fixture.variant, 1);
    for (let i = 0; i < fixture.buyers.length; i++) {
      const buyer = fixture.buyers[i];
      assert.equal((await owner.query('select status from public.orders where id=$1', [buyer.order])).rows[0].status, i === winner ? 'accepted' : 'quoted');
      assert.equal((await owner.query('select count(*)::int n from commerce_private.command_requests where request_id=$1', [buyer.request])).rows[0].n, i === winner ? 1 : 0);
      assert.equal((await owner.query('select count(*)::int n from public.inventory_movements where order_id=$1 and reserved_delta=1 and quantity_delta=0', [buyer.order])).rows[0].n, i === winner ? 1 : 0);
    }
  } catch (error) {
    // Assertions are authored here; omit provider diagnostics, URLs and passwords.
    failure = error?.code === 'ERR_ASSERTION' ? new Error(error.message.split('\n')[0]) : new Error('PostgreSQL verification failed; inspect the isolated branch privately.');
  } finally {
    // Unlock even after a failed barrier; then drain queries before ending clients.
    try { await owner.query('ROLLBACK'); await owner.query('select pg_advisory_unlock(741821,1)'); } catch { cleanupFailed = true; }
    await Promise.allSettled(pending);
    for (const client of clients.filter(client => client !== owner)) {
      try { await client.end(); } catch { cleanupFailed = true; }
    }
    if (roleCommitted) {
      try {
        const provenance = (await owner.query(`select oid,shobj_description(oid,'pg_authid') as marker from pg_roles where rolname=$1`, [role])).rows[0];
        assert.equal(provenance?.oid, roleOid);
        assert.equal(provenance?.marker, marker);
        await owner.query(`DROP ROLE ${ident(role)}`);
      } catch { cleanupFailed = true; }
    }
    try { await owner.end(); } catch { cleanupFailed = true; }
    if (cleanupFailed) t.diagnostic('Connection/temporary LOGIN cleanup was not confirmed; inspect the isolated branch. No schema or data cleanup was attempted.');
  }
  if (failure) throw failure;
  assert.equal(cleanupFailed, false, 'Temporary LOGIN and connection cleanup must be confirmed');
}

const synthetic = 'postgresql://fixture:synthetic@127.0.0.1/verification?sslmode=disable';
test('preflight skips without BOTH explicit controls, without constructing a client', () => {
  for (const env of [{}, { DATABASE_URL: synthetic }, { TEST_DATABASE_URL: synthetic },
    { TEST_DATABASE_BRANCH_OPT_IN: OPT_IN }, { TEST_DATABASE_URL: synthetic, TEST_DATABASE_BRANCH_OPT_IN: 'true' },
    { TEST_DATABASE_URL: 'not a URL' }]) assert.equal(configuration(env), null);
});
test('preflight accepts only explicit direct credentials with bounded connection settings', () => {
  const config = configuration({ TEST_DATABASE_URL: synthetic, TEST_DATABASE_BRANCH_OPT_IN: OPT_IN });
  assert.equal(config.user, 'fixture'); assert.equal(config.database, 'verification');
  assert.equal(config.connectionTimeoutMillis, 10000); assert.equal(config.query_timeout, 25000);
  assert.equal(config.statement_timeout, 20000); assert.equal(config.lock_timeout, 15000);
  assert.equal(config.ssl, false);
});
test('preflight rejects alternate credentials, pooled endpoints and unsafe URL options', () => {
  for (const url of ['https://fixture:synthetic@example.invalid/db', 'postgresql://localhost/db',
    'postgresql://fixture:synthetic@example-pooler.invalid/db',
    'postgresql://fixture:synthetic@example.invalid/db?sslmode=disable',
    synthetic + '&user=owner', synthetic + '&options=-c%20statement_timeout=0',
    synthetic + '&sslmode=disable', synthetic + '#fragment']) {
    assert.throws(() => configuration({ TEST_DATABASE_URL: url, TEST_DATABASE_BRANCH_OPT_IN: OPT_IN }));
  }
});
test('preflight validates the local migration chain without connecting', async () => {
  assert.ok((await loadMigrations()).length > 0);
});
const enabled = Boolean(process.env.TEST_DATABASE_URL?.trim()) && process.env.TEST_DATABASE_BRANCH_OPT_IN === OPT_IN;
test('PostgreSQL: two runtime connections compete for the last fixed unit', {
  skip: enabled ? false : 'Requires TEST_DATABASE_URL and TEST_DATABASE_BRANCH_OPT_IN=isolated-verification-branch',
  timeout: 180000,
}, async t => runLive(configuration(process.env), t));
