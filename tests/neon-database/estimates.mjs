import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const db = new PGlite();
let passed=0;
const check=name=>{passed++; console.log(`PASS ${name}`);};
async function as(subject, fn) {
 await db.exec('set session authorization estimate_runtime; begin');
 try { await db.query('select commerce_identity.begin_request($1,$2,$1,true)',[subject,`${subject}@example.invalid`]); const result=await fn(); await db.exec('commit'); return result; }
 catch(e){await db.exec('rollback'); throw e;}
 finally{await db.exec('set session authorization postgres');}
}
const settings=(action,payload)=>db.query('select estimate_settings_command($1,$2::jsonb) result',[action,JSON.stringify(payload)]);
const estimate=(lines,mode='pickup')=>db.query('select cart_estimate($1::jsonb,$2) result',[JSON.stringify(lines),mode]);
try {
 const dir=new URL('../../neon/migrations/',import.meta.url);
 for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(f,dir),'utf8'));
 await db.exec('create role estimate_runtime login; grant commerce_runtime to estimate_runtime');
 const owner=await as('owner',()=>db.query('select commerce_identity.uid() id'));
 await db.query('insert into admins(user_id) values($1)',[owner.rows[0].id]);
 const buyer=(await as('buyer',()=>db.query('select customer_workspace() w'))).rows[0].w.customer.id;
 const product=randomUUID(), variant=randomUUID();
 await db.query("insert into products(id,name,slug,category,description,active) values($1,'Feed','feed','Feed','Fixture',true)",[product]);
 await db.query("insert into variants(id,product_id,label,weight_kg,reference_price_paise) values($1,$2,'Bag',50,12000)",[variant,product]);
 await db.query('insert into inventory(variant_id,on_hand,reserved) values($1,10,2) on conflict(variant_id) do update set on_hand=10,reserved=2',[variant]);
 const lines=[{variant_id:variant,quantity:2}];
 await assert.rejects(as('buyer',()=>estimate(lines)),/approval/);check('unapproved denied');
 await assert.rejects(as('buyer',()=>settings('set_estimate_approval',{request_id:randomUUID(),customer_id:buyer,approved:true})),/Administrator/);check('self approval denied');
 const approval={request_id:randomUUID(),customer_id:buyer,approved:true};
 await as('owner',()=>settings('set_estimate_approval',approval));
 await as('owner',()=>settings('set_estimate_approval',approval));
 assert.equal(Number((await db.query('select count(*) n from audit_log where action=$1',['set_estimate_approval'])).rows[0].n),1);check('approval idempotent audit');
 let value=(await as('buyer',()=>estimate(lines))).rows[0].result;
 assert.equal(value.goods_total_paise,24000); assert.equal(value.total_max_paise,24000);assert.equal(value.reserves_stock,false);check('stored prices and pickup totals');
 value=(await as('buyer',()=>estimate(lines,'shop_delivery'))).rows[0].result;
 assert.equal(value.total_max_paise,null);check('unknown delivery remains unknown');
 await as('owner',()=>settings('set_delivery_range',{request_id:randomUUID(),min_paise:1000,max_paise:2000}));
 value=(await as('buyer',()=>estimate(lines,'shop_delivery'))).rows[0].result;
 assert.equal(value.total_min_paise,25000);assert.equal(value.total_max_paise,26000);check('delivery range included');
 for(const invalid of [[{variant_id:variant,quantity:1.5}],[...lines,...lines],[{variant_id:variant,quantity:9}],[{variant_id:variant,quantity:2,unit_price_paise:1}],[]]) await assert.rejects(as('buyer',()=>estimate(invalid)));
 check('fractional duplicate unavailable forged and empty lines denied');
 await assert.rejects(as('owner',()=>settings('set_delivery_range',{request_id:randomUUID(),min_paise:2000,max_paise:1000})));check('invalid delivery range denied');
 await as('owner',()=>settings('set_estimate_approval',{request_id:randomUUID(),customer_id:buyer,approved:false}));
 await assert.rejects(as('buyer',()=>estimate(lines)),/approval/);check('revocation enforced');
 assert.equal((await db.query('select reserved from inventory where variant_id=$1',[variant])).rows[0].reserved,2);check('estimates never reserve');
 await db.exec('set session authorization estimate_runtime');
 await assert.rejects(estimate(lines)); await db.exec('set session authorization postgres');check('missing identity denied');
 console.log(`${passed} checks passed`);
} finally {await db.close();}
