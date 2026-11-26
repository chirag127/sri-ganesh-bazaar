import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, validateMigrations, main, loadMigrations } from '../../scripts/migrate-database.mjs';
const first = {name:'202611240001_first.sql',sql:'create table example(id integer);'};
const second = {name:'202611240002_second.sql',sql:'insert into example values(1);'};
async function fixture(t) { const db=new PGlite(); t.after(()=>db.close()); return {db,client:{query:(sql,args)=> args ? db.query(sql,args) : sql.startsWith('SELECT') ? db.query(sql) : db.exec(sql).then(()=>({rows:[]}))}}; }
test('applies all pending SQL and records checksums; reruns are no-ops',async t=>{const {db,client}=await fixture(t);assert.deepEqual((await applyMigrations(client,[first,second])).applied,[first.name,second.name]);assert.equal((await applyMigrations(client,[first,second])).previouslyApplied,2);assert.equal((await db.query('select count(*)::int n from example')).rows[0].n,1);});
test('failed initial sequence rolls back schema and all migrations',async t=>{const {db,client}=await fixture(t);await assert.rejects(applyMigrations(client,[first,{...second,sql:'insert into missing values(1)'}]));assert.equal((await db.query("select to_regclass('example') r")).rows[0].r,null);assert.equal((await db.query("select to_regclass('commerce_migrations.history') r")).rows[0].r,null);});
test('failed upgrade preserves prior history and rolls back pending SQL',async t=>{const {db,client}=await fixture(t);await applyMigrations(client,[first]);await assert.rejects(applyMigrations(client,[first,second,{name:'202611240003_bad.sql',sql:'select nonexistent();'}]));assert.equal((await db.query('select count(*)::int n from example')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from commerce_migrations.history')).rows[0].n,1);});
for(const kind of ['changed','unknown','gap'])test(`rejects ${kind} history`,async t=>{const {db,client}=await fixture(t);await applyMigrations(client,[first]);if(kind==='changed')await assert.rejects(applyMigrations(client,[{...first,sql:first.sql+' -- changed'}]));else {await db.query(kind==='unknown'?"update commerce_migrations.history set name='unknown.sql'":"update commerce_migrations.history set position=2");await assert.rejects(applyMigrations(client,[first,second]));}});
test('rejects transaction escape before opening transaction',async()=>{for(const sql of ['COMMIT;','select 1; ROLLBACK;','BEGIN;','START TRANSACTION;'])assert.throws(()=>validateMigrations([{...first,sql}]));assert.doesNotThrow(()=>validateMigrations([{...first,sql:"create function f() returns void language plpgsql as $$ BEGIN RETURN; END $$;"}]));});
test('requires explicit apply and dedicated configuration',async()=>{await assert.rejects(main([],{}));await assert.rejects(main(['--apply'],{DATABASE_URL:'unused'}));});
test('serializes before history inspection and commits last',async()=>{const calls=[];await applyMigrations({query:async sql=>{calls.push(sql);return {rows:sql.includes('AS trusted')?[{trusted:true}]:[]};}},[first]);assert.equal(calls[0],'BEGIN');assert.ok(calls.findIndex(s=>s.includes('pg_advisory_xact_lock'))<calls.findIndex(s=>s.includes('CREATE SCHEMA')));assert.equal(calls.at(-1),'COMMIT');});
test('actual repository migrations pass preflight',async()=>{assert.ok((await loadMigrations()).length>0);});
test('applies the full repository migration chain and reruns without changing history', async t => {
  // This fresh database is exclusively owned by this test, with no active transaction.
  const db = new PGlite();
  t.after(() => db.close());
  const client = {
    query: async (sql, args) => args
      ? db.query(sql, args)
      : (await db.exec(sql)).at(-1) ?? { rows: [] },
  };
  // exec uses the simple-query protocol so actual multi-statement files stay intact.
  const migrations = await loadMigrations();
  assert.ok(migrations.length > 0);
  assert.deepEqual(await applyMigrations(client, migrations), {
    applied: migrations.map(migration => migration.name),
    previouslyApplied: 0,
  });
  const historySql = 'select position, name, checksum, applied_at from commerce_migrations.history order by position';
  const history = (await db.query(historySql)).rows;
  assert.equal(history.length, migrations.length);
  assert.deepEqual(history.map(({ position, name, checksum }) => ({ position, name, checksum })),
    migrations.map(({ name, checksum }, index) => ({ position: index + 1, name, checksum })));
  for (const relation of [
    'commerce_identity.users', 'public.products', 'public.variants', 'public.inventory',
    'public.orders', 'public.quotes', 'public.ledger_entries', 'public.bills',
    'commerce_private.sale_costs', 'commerce_private.payment_evidence',
    'public.product_requests', 'commerce_private.admin_alerts',
    'public.owner_analytics_low_stock_idx',
  ]) {
    assert.equal((await db.query('select to_regclass($1) is not null as present', [relation])).rows[0].present,
      true, `Missing commerce relation: ${relation}`);
  }
  for (const signature of [
    'public.catalog_snapshot()', 'public.commerce_command(text,jsonb)',
    'public.customer_workspace()', 'public.admin_workspace()',
    'public.cart_estimate(jsonb,text)', 'public.owner_analytics(date,date)',
  ]) {
    assert.equal((await db.query('select to_regprocedure($1) is not null as present', [signature])).rows[0].present,
      true, `Missing commerce function: ${signature}`);
  }
  assert.deepEqual(await applyMigrations(client, await loadMigrations()), {
    applied: [],
    previouslyApplied: migrations.length,
  });
  assert.equal((await db.query('select count(*)::int n from commerce_migrations.history')).rows[0].n,
    migrations.length);
  assert.deepEqual((await db.query(historySql)).rows, history);
});
for (const alteration of [
  'alter schema commerce_migrations owner to outsider',
  'alter table commerce_migrations.history owner to outsider',
  'grant create on schema commerce_migrations to outsider',
  'grant delete on commerce_migrations.history to outsider',
  'grant update(checksum) on commerce_migrations.history to outsider',
  'grant insert on commerce_migrations.history to public',
]) test(`rejects untrusted history: ${alteration}`, async t => {
  const {db,client}=await fixture(t);
  await applyMigrations(client,[first]);
  await db.exec('create role outsider');
  await db.exec(alteration);
  await assert.rejects(applyMigrations(client,[first,second]));
  assert.equal((await db.query('select count(*)::int n from example')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from commerce_migrations.history')).rows[0].n,1);
  if (alteration.includes('owner to')) {
    const query=alteration.startsWith('alter schema') ? "select pg_get_userbyid(nspowner) owner from pg_namespace where nspname='commerce_migrations'" : "select pg_get_userbyid(relowner) owner from pg_class where oid='commerce_migrations.history'::regclass";
    assert.equal((await db.query(query)).rows[0].owner,'outsider');
  }
});
test('rejects default write grants and rolls back new history', async t => {
  const {db,client}=await fixture(t);
  await db.exec('create role outsider; alter default privileges grant insert on tables to outsider');
  await assert.rejects(applyMigrations(client,[first]));
  assert.equal((await db.query("select to_regclass('commerce_migrations.history') r")).rows[0].r,null);
});
