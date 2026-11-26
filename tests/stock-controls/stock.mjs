import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const db=new PGlite(); let passed=0;
const check=n=>{passed++;console.log(`PASS ${n}`);};
async function as(who,fn){await db.exec('set session authorization stock_runtime; begin');try{await db.query('select commerce_identity.begin_request($1,$2,$1,true)',[who,`${who}@example.invalid`]);const r=await fn();await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}finally{await db.exec('set session authorization postgres');}}
const cmd=(action,payload)=>db.query('select commerce_command($1,$2::jsonb) result',[action,JSON.stringify(payload)]);
try{
const dir=new URL('../../neon/migrations/',import.meta.url);for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
await db.exec('create role stock_runtime login; grant commerce_runtime to stock_runtime');
const owner=(await as('owner',()=>db.query('select commerce_identity.uid() id'))).rows[0].id;await db.query('insert into admins(user_id) values($1)',[owner]);
const buyer=(await as('buyer',()=>db.query('select customer_workspace() w'))).rows[0].w.customer.id;
await db.query("update customers set phone='+919876543210',estimate_approved=true where id=$1",[buyer]);
const p=randomUUID(),v=randomUUID();await db.query("insert into products(id,name,slug,category,description,active) values($1,'Feed','feed','Feed','Fixture',true)",[p]);await db.query("insert into variants(id,product_id,label,weight_kg,reference_price_paise) values($1,$2,'Bag',50,10000)",[v,p]);await db.query('insert into inventory(variant_id,on_hand,reserved,average_cost_paise) values($1,10,2,5000)',[v]);
const count={request_id:randomUUID(),variant_id:v,expected_on_hand:10,counted_on_hand:8,reason:'Physical count'};
await assert.rejects(as('buyer',()=>cmd('count_stock',count)),/Administrator/);check('customer count denied');
await as('owner',()=>cmd('count_stock',count));await as('owner',()=>cmd('count_stock',count));assert.equal((await db.query('select on_hand from inventory where variant_id=$1',[v])).rows[0].on_hand,8);assert.equal(Number((await db.query('select count(*) n from inventory_movements')).rows[0].n),1);check('count idempotent');
await assert.rejects(as('owner',()=>cmd('count_stock',{...count,request_id:randomUUID()})),/Stock changed/);check('stale count denied');
for(const n of [1,-1,1.5,10000001])await assert.rejects(as('owner',()=>cmd('count_stock',{...count,request_id:randomUUID(),expected_on_hand:8,counted_on_hand:n})));check('reserved and integer bounds protected');
await assert.rejects(as('owner',()=>cmd('count_stock',{...count,request_id:randomUUID(),expected_on_hand:8,reason:''})));check('reason mandatory');
await as('owner',()=>cmd('adjust_stock',{request_id:randomUUID(),variant_id:v,quantity_delta:1,unit_cost_paise:5000,reason:'Receipt'}));check('existing delta command preserved');
const pause={request_id:randomUUID(),variant_id:v,available:false,reason:'Quality check'};await as('owner',()=>cmd('set_stock_availability',pause));await as('owner',()=>cmd('set_stock_availability',pause));
const pub=(await db.query('select catalog_snapshot() c')).rows[0].c;assert.equal(pub.products.length,1);assert.equal(pub.products[0].variants[0].available,false);assert.equal('reference_price_paise' in pub.products[0].variants[0],false);check('paused listing visible without prices');
await assert.rejects(as('buyer',()=>cmd('submit_enquiry',{request_id:randomUUID(),lines:[{variant_id:v,quantity:1}],fulfillment:'pickup'})),/unavailable/);check('paused enquiry denied');
await assert.rejects(as('buyer',()=>db.query('select cart_estimate($1::jsonb,$2)',[JSON.stringify([{variant_id:v,quantity:1}]),'pickup'])),/unavailable/);check('paused estimate denied');
assert.equal((await db.query('select reserved from inventory where variant_id=$1',[v])).rows[0].reserved,2);check('pause preserves reservations');
await as('owner',()=>cmd('set_stock_availability',{...pause,request_id:randomUUID(),available:true}));assert.equal((await db.query('select catalog_snapshot() c')).rows[0].c.products[0].variants[0].available,true);check('resume selling');
await db.exec('set session authorization stock_runtime');await assert.rejects(db.query('select commerce_command_before_stock($1,$2::jsonb)',['adjust_stock','{}']));await db.exec('set session authorization postgres');check('old dispatcher inaccessible');
console.log(`${passed} checks passed`);
}finally{await db.close();}
