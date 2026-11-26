import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const db = new PGlite();
let passed = 0;
const check = (name) => { passed++; console.log(`PASS ${name}`); };
async function request(subject, fn) {
 await db.exec('set session authorization test_runtime; begin');
 try {
  const {rows} = await db.query('select commerce_identity.begin_request($1,$2,$3,true) id',[subject,`${subject}@example.invalid`,subject]);
  const value = await fn(rows[0].id);
  await db.exec('commit'); return value;
 } catch(e) { await db.exec('rollback'); throw e; }
 finally { await db.exec('set session authorization postgres'); }
}
const command = async(action,payload) => (await db.query('select commerce_command($1,$2::jsonb) result',[action,JSON.stringify({request_id:randomUUID(),...payload})])).rows[0].result;
try {
 const dir = new URL('../neon/migrations/', import.meta.url);
 for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort()) { await db.exec(await readFile(new URL(file,dir),'utf8')); check(file); }
 await db.exec('create role test_runtime login; grant commerce_runtime to test_runtime; create role test_guest login; grant commerce_guest to test_guest; create role test_worker login; grant commerce_worker to test_worker;');
 const admin = await request('admin',id=>id);
 await db.query('insert into admins(user_id) values($1)',[admin]);
 const customer = await request('buyer',async()=>{ await command('save_profile',{name:'Buyer',phone:'+919876543210'}); return (await db.query('select customer_workspace() w')).rows[0].w.customer.id; });
 check('trusted subject maps to stable customer');
 await db.exec('set session authorization test_guest');
 await assert.rejects(db.query('select * from inventory'));
 await assert.rejects(db.query("select commerce_identity.begin_request('admin',null,null,true)"));
 await db.exec('set session authorization postgres'); check('guest cannot read inventory or assert identity');
 await request('buyer',async()=>{ await assert.rejects(command('adjust_stock',{variant_id:randomUUID(),quantity_delta:1,unit_cost_paise:1,reason:'attack'})); });
 check('customer cannot mutate stock');
 let variant, order, quote;
 await request('admin',async()=>{
  const p=await command('save_product',{name:'Test bags',slug:'test-bags',category:'Grain',description:'Fixture',active:true,variants:[{label:'50kg',weight_kg:50,reference_price_paise:10000}]});
  const w=(await db.query('select admin_workspace() w')).rows[0].w; variant=w.products.find(x=>x.id===p.id).variants[0].id;
  await command('adjust_stock',{variant_id:variant,quantity_delta:10,unit_cost_paise:5000,reason:'Fixture stock'});
 });
 await db.exec('set session authorization test_guest');
 const publicCatalog=(await db.query('select catalog_snapshot() catalog')).rows[0].catalog;
 assert.equal(publicCatalog.products[0].variants[0].id,variant);
 assert.equal(JSON.stringify(publicCatalog).includes('reference_price_paise'),false);
 assert.equal(JSON.stringify(publicCatalog).includes('average_cost_paise'),false);
 await assert.rejects(db.query('select * from variants'));
 await db.exec('set session authorization postgres');
 await request('admin',async()=>{
  const workspace=(await db.query('select admin_workspace() w')).rows[0].w;
  assert.equal(workspace.products[0].variants[0].reference_price_paise,10000);
 });
 check('anonymous catalog omits prices while authorized admin retains prices');
 await request('buyer',async()=>{
  const payload={request_id:randomUUID(),lines:[{variant_id:variant,quantity:2}],fulfillment:'pickup'};
  order=(await command('submit_enquiry',payload)).id;
  assert.equal((await command('submit_enquiry',payload)).id,order);
 }); check('enquiry retries are idempotent');
 await request('admin',async()=>{ quote=(await command('issue_quote',{order_id:order,lines:[{variant_id:variant,quantity:2,unit_price_paise:10000}],transport_paise:0,deposit_paise:0,reservation_until:new Date(Date.now()+86400000).toISOString(),notes:'Fixture',credit_approved:false})).id; });
 await request('buyer',()=>command('accept_quote',{order_id:order,quote_id:quote}));
 assert.equal((await db.query('select reserved from inventory')).rows[0].reserved,2); check('quote acceptance reserves stock');
 await request('other',async()=>{ await assert.rejects(db.query('select customer_order_detail($1)',[order])); }); check('cross-customer history denied');
 await request('admin',async()=>{
  await command('record_payment',{customer_id:customer,order_id:order,amount_paise:20000,method:'cash',received_by:'shop',note:'Actual fixture receipt'});
  await command('advance_order',{order_id:order,status:'ready'});
  await command('advance_order',{order_id:order,status:'completed',handover_note:'Fixture handover'});
 });
 assert.equal((await db.query('select on_hand from inventory')).rows[0].on_hand,8);
 assert.equal(Number((await db.query('select sum(amount_paise) balance from ledger_entries where customer_id=$1',[customer])).rows[0].balance),0);
 check('handover consumes once and ledger balances');
 await assert.rejects(db.exec('update ledger_entries set amount_paise=1')); check('posted ledger immutable');
 await request('admin',async()=>{ await assert.rejects(command('set_admin',{email:'admin@example.invalid',enabled:false})); }); check('last admin protected');
 await db.exec('set session authorization test_runtime');
 await assert.rejects(db.query('select customer_workspace()')); await assert.rejects(db.query('select notification_claim(1)'));
 await db.exec('set session authorization postgres'); check('transaction identity does not leak; worker API isolated');
 await request('buyer',async(id)=>{
  const path=`${id}/${order}/${randomUUID()}.png`;
  await db.query('select register_payment_evidence($1,$2,100,\'image/png\')',[path,order]);
  assert.equal((await db.query('select payment_evidence_access($1) allowed',[path])).rows[0].allowed,true);
 }); check('trusted upload metadata enforces ownership');
 await assert.rejects(request('other',()=>db.query('select register_payment_evidence($1,$2,100,\'image/png\')',[`${admin}/${order}/${randomUUID()}.png`,order])));
 check('foreign evidence registration denied');
 const stockBefore=(await db.query('select on_hand from inventory')).rows[0].on_hand;
 const billsBefore=(await db.query('select count(*) n from bills')).rows[0].n;
 await assert.rejects(request('admin',()=>command('counter_sale',{customer_id:customer,lines:[{variant_id:variant,quantity:100,unit_price_paise:10000}],paid_paise:1000000,method:'cash',credit_approved:false,note:'Insufficient stock fixture'})));
 assert.equal((await db.query('select on_hand from inventory')).rows[0].on_hand,stockBefore);
 assert.equal((await db.query('select count(*) n from bills')).rows[0].n,billsBefore); check('failed sale rolls back inventory and bills');
 await assert.rejects(request('admin',()=>command('record_payment',{customer_id:customer,order_id:order,amount_paise:100,method:'upi',reference:'fixture-unverified',note:'Not bank verified'})));
 check('unverified UPI receipt rejected');
 await request('admin',()=>command('record_return',{order_id:order,lines:[{variant_id:variant,quantity:1,restock:true}],amount_paise:10000,note:'Fixture return'}));
 assert.equal((await db.query('select on_hand from inventory')).rows[0].on_hand,9);
 await request('admin',()=>command('record_refund',{customer_id:customer,order_id:order,amount_paise:10000,method:'cash',note:'Fixture refund'}));
 assert.equal(Number((await db.query('select sum(amount_paise) balance from ledger_entries where customer_id=$1',[customer])).rows[0].balance),0);
 check('return and refund preserve ledger and stock');
 await assert.rejects(request('admin',()=>command('record_refund',{customer_id:customer,amount_paise:1,method:'cash',note:'Excess refund'})));
 check('refund cannot exceed available credit');
 // PGlite is single-session: simulate a revocation by the prior lock holder
 // inside the lock hook, then verify authorization is evaluated afterwards.
 const revoked = await request('revoked',id=>id);
 await db.query('insert into admins(user_id) values($1)',[revoked]);
 await db.exec('alter table admins disable trigger guard_last_admin');
 await db.exec(`create or replace function commerce_private.mutation_lock() returns void language plpgsql volatile set search_path=pg_catalog as $$ begin delete from public.admins where user_id=commerce_identity.uid() and user_id='${revoked}'; end $$`);
 await assert.rejects(request('revoked',()=>command('create_customer',{name:'Forbidden'})),/Administrator access required/);
 check('admin authorization occurs after serialization/revocation');
 await db.exec(`create or replace function commerce_private.mutation_lock() returns void language sql volatile set search_path=pg_catalog as $$ select pg_advisory_xact_lock(741821,1) $$`);
 await db.exec('alter table admins enable trigger guard_last_admin');
 await db.exec('set session authorization test_runtime; begin isolation level repeatable read');
 await db.query('select commerce_identity.begin_request($1,$2,$3,true)',['admin','admin@example.invalid','admin']);
 await assert.rejects(command('create_customer',{name:'Forbidden snapshot'}),/READ COMMITTED/);
 await db.exec('rollback; set session authorization postgres');
 check('stale-snapshot isolation rejected');
 console.log(`${passed} checks passed`);
} finally { await db.close(); }
