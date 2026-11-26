import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const db=new PGlite(); let passed=0;
const check=n=>{passed++;console.log(`PASS ${n}`);};
async function as(who,fn){await db.exec('set session authorization units_runtime; begin');try{await db.query('select commerce_identity.begin_request($1,$2,$1,true)',[who,`${who}@example.invalid`]);const r=await fn();await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}finally{await db.exec('set session authorization postgres');}}
const cmd=(a,p)=>db.query('select commerce_command($1,$2::jsonb) result',[a,JSON.stringify(p)]);
try {
 const dir=new URL('../../neon/migrations/',import.meta.url);for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 await db.exec('create role units_runtime login; grant commerce_runtime to units_runtime');
 const owner=(await as('owner',()=>db.query('select commerce_identity.uid() id'))).rows[0].id;await db.query('insert into admins(user_id) values($1)',[owner]);
 const payload={request_id:randomUUID(),name:'Fixed units',slug:'fixed-units',category:'Feed',description:'Fixture',active:true,variants:['bag','jar','bottle','piece','pack'].map(unit_kind=>({label:unit_kind,unit_kind,weight_kg:null,reference_price_paise:10000}))};
 await assert.rejects(as('buyer',()=>cmd('save_product',payload)),/Administrator/);check('customer product edit denied');
 const id=(await as('owner',()=>cmd('save_product',payload))).rows[0].result.id;
 await as('owner',()=>cmd('save_product',payload));
 const variants=(await db.query('select * from variants where product_id=$1 order by label',[id])).rows;
 assert.equal(variants.length,5);assert.ok(variants.every(v=>v.weight_kg===null));check('all fixed units with optional weight and idempotency');
 const pub=(await db.query('select catalog_snapshot() c')).rows[0].c;
 assert.ok(pub.products[0].variants.every(v=>!('reference_price_paise' in v)&&v.unit_kind));check('public unit metadata without prices');
 const v=variants[0];
 await as('owner',()=>cmd('adjust_stock',{request_id:randomUUID(),variant_id:v.id,quantity_delta:3,unit_cost_paise:100,reason:'Receipt'}));
 const update={...payload,id,request_id:randomUUID(),variants:variants.map(x=>({id:x.id,label:x.label,unit_kind:x.unit_kind,weight_kg:null,reference_price_paise:12000}))};
 await as('owner',()=>cmd('save_product',update));check('used unit price remains editable');
 for(const patch of [{label:'different'},{unit_kind:'jar'},{weight_kg:2}])await assert.rejects(as('owner',()=>cmd('save_product',{...update,request_id:randomUUID(),variants:update.variants.map(x=>x.id===v.id?{...x,...patch}:x)})),/immutable/);
 check('used label kind and weight immutable');
 for(const weight of [-1,0,10001,1.0001,'2'])await assert.rejects(as('owner',()=>cmd('save_product',{...payload,request_id:randomUUID(),slug:randomUUID(),variants:[{label:'bad',unit_kind:'jar',weight_kg:weight,reference_price_paise:1}]})));
 check('invalid physical weights denied');
 const threshold={request_id:randomUUID(),variant_id:v.id,reorder_level:5};
 await assert.rejects(as('buyer',()=>cmd('set_reorder_level',threshold)),/Administrator/);check('threshold owner only');
 await as('owner',()=>cmd('set_reorder_level',threshold));await as('owner',()=>cmd('set_reorder_level',threshold));
 assert.equal((await db.query('select reorder_level from inventory where variant_id=$1',[v.id])).rows[0].reorder_level,5);
 assert.equal(Number((await db.query("select count(*) n from audit_log where action='set_reorder_level'")).rows[0].n),1);check('threshold persisted and audited once');
 for(const n of [-1,1.5,10000001])await assert.rejects(as('owner',()=>cmd('set_reorder_level',{...threshold,request_id:randomUUID(),reorder_level:n})));
 await assert.rejects(as('owner',()=>cmd('set_reorder_level',{...threshold,reorder_level:6})),/already used/);check('threshold bounds and retry collision');
 await db.exec('set session authorization units_runtime');await assert.rejects(db.query("select commerce_command_before_units('save_product','{}')"));await db.exec('set session authorization postgres');check('old dispatcher inaccessible');
 console.log(`${passed} checks passed`);
} finally {await db.close();}
