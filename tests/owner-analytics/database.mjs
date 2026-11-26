import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const db = new PGlite(); let passed=0; const check=n=>{passed++;console.log('PASS '+n);};
async function as(subject, work) { await db.exec('set session authorization analytics_runtime; begin'); try { await db.query('select commerce_identity.begin_request($1,$2,$1,true)',[subject,subject+'@example.invalid']); const result=await work(); await db.exec('commit'); return result; } catch(e){await db.exec('rollback');throw e;} finally {await db.exec('set session authorization postgres');} }
const report=(a='2026-01-01',b='2026-01-31')=>db.query('select owner_analytics($1::date,$2::date) r',[a,b]);
try {
 const dir=new URL('../../neon/migrations/',import.meta.url); for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(f,dir),'utf8'));
 await db.exec('create role analytics_runtime login; grant commerce_runtime to analytics_runtime');
 const owner=(await as('owner',()=>db.query('select commerce_identity.uid() id'))).rows[0].id; await db.query('insert into admins(user_id) values($1)',[owner]);
 const buyer=(await as('buyer',()=>db.query('select customer_workspace() w'))).rows[0].w.customer.id;
 await assert.rejects(as('buyer',()=>report()),/Administrator/);check('customer denied');
 await db.exec('set session authorization commerce_guest');await assert.rejects(report(),/permission/);await db.exec('set session authorization postgres');check('guest denied');
 for(const bounds of [[null,'2026-01-31'],['2026-02-01','2026-01-01'],['2025-01-01','2026-01-02'],['infinity','infinity']]) await assert.rejects(as('owner',()=>report(...bounds)));check('date bounds enforced');
 const empty=(await as('owner',()=>report())).rows[0].r; assert.equal(empty.billed_sales,0);assert.equal(empty.enquiries_created,0);check('empty report truthful');
 for(const status of ['enquiry','accepted','completed']) await db.query("insert into orders(customer_id,status,fulfillment,lines,created_at) values($1,$2,'pickup','[]','2026-01-10T00:00:00Z')",[buyer,status]);
 await db.query("insert into commerce_private.command_requests(actor_id,request_id,action,payload,result,created_at) values($1,$2,'submit_enquiry','{}','{}','2026-01-10T00:00:00Z')",[owner,randomUUID()]);
 const order=(await db.query("select id from orders where status='completed'")).rows[0].id;
 await db.query("insert into bills(order_id,customer_id,total_paise,transport_paise,lines,issued_at) values($1,$2,100,0,'[]','2026-01-11T00:00:00Z')",[order,buyer]);
 await db.query("insert into product_requests(customer_id,description,status,created_at) values($1,'PRIVATE','pending','2026-01-12T00:00:00Z'),($1,'PRIVATE','resolved','2026-01-12T00:00:00Z'),($1,'PRIVATE','pending','2025-12-01T00:00:00Z')",[buyer]);
 let r=(await as('owner',()=>report())).rows[0].r;
 assert.equal(r.enquiries_created,1);assert.equal(r.accepted_orders_current,2);assert.equal(r.billed_sales,1);assert.equal(r.pending_requests_created,1);check('enquiries acceptance bills and pending demand separated');
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE|example.invalid|customer_id|price/);check('aggregate response excludes personal and price fields');
 await db.query("insert into commerce_private.command_requests(actor_id,request_id,action,payload,result,created_at) values($1,$2,'submit_enquiry','{}','{}','2025-12-31T18:30:00Z'),($1,$3,'submit_enquiry','{}','{}','2026-01-31T18:30:00Z')",[owner,randomUUID(),randomUUID()]);
 r=(await as('owner',()=>report())).rows[0].r;assert.equal(r.enquiries_created,2);check('India inclusive date boundaries');
 const p=randomUUID(),v=randomUUID();await db.query("insert into products(id,name,slug,category,active) values($1,'Feed','analytics-feed','Feed',true)",[p]);await db.query("insert into variants(id,product_id,label,weight_kg,reference_price_paise) values($1,$2,'Bag',50,100)",[v,p]);await db.query('insert into inventory(variant_id,on_hand,reserved,reorder_level) values($1,5,3,2)',[v]);
 r=(await as('owner',()=>report())).rows[0].r;assert.equal(r.low_stock_now,1);check('low stock uses available quantity');
 const definition=(await db.query("select provolatile, pg_get_functiondef(oid) definition from pg_proc where oid='public.owner_analytics(date,date)'::regprocedure")).rows[0];
 assert.equal(definition.provolatile,'s');assert.doesNotMatch(definition.definition,/mutation_lock/);check('report uses stable statement snapshot without mutation lock');
 const indexes=await db.query("select indexname from pg_indexes where indexname like 'owner_analytics_%'");assert.equal(indexes.rows.length,5);check('report predicate indexes exist');
 const secondOwner=(await as('second-owner',()=>db.query('select commerce_identity.uid() id'))).rows[0].id;
 await db.query('insert into admins(user_id) values($1)',[secondOwner]);
 await db.query('delete from admins where user_id=$1',[owner]);
 await assert.rejects(as('owner',()=>report()),/Administrator/);check('committed owner revocation denies subsequent report');
 console.log(`${passed} checks passed`);
} finally {await db.close();}
