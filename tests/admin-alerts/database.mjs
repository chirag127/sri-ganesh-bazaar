import { PGlite } from '@electric-sql/pglite';
import { readFile,readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();let count=0;const pass=n=>{count++;console.log('PASS '+n)};
try {
 const dir=new URL('../../neon/migrations/',import.meta.url);for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 await db.exec('create role alert_worker login; grant commerce_worker to alert_worker; create role alert_runtime login; grant commerce_runtime to alert_runtime');
 async function worker(sql,args=[]){await db.exec('set session authorization alert_worker');try{return await db.query(sql,args)}finally{await db.exec('set session authorization postgres')}}
 await db.exec('set session authorization alert_runtime');await assert.rejects(db.query('select admin_alert_claim()'));await db.exec('set session authorization postgres');pass('runtime denied worker RPC');
 const customer=(await db.query("insert into customers(name) values('Fixture') returning id")).rows[0].id;
 const order=(await db.query("insert into orders(customer_id,fulfillment,lines) values($1,'pickup','[]') returning id",[customer])).rows[0].id;
 await db.query("update orders set status='accepted' where id=$1",[order]);
 await db.query("update orders set status='accepted' where id=$1",[order]);
 await db.query("insert into payment_submissions(customer_id,order_id,amount_paise,reference) values($1,$2,100,'fixture')",[customer,order]);
 assert.deepEqual((await db.query('select event from commerce_private.admin_alerts order by event')).rows.map(r=>r.event),['new_enquiry','payment_submitted','quote_accepted']);pass('transactional order and payment triggers deduplicate');
 const product=(await db.query("insert into products(slug,name,category) values('fixture','Fixture','Feed') returning id")).rows[0].id;
 const variant=(await db.query("insert into variants(product_id,label,weight_kg,reference_price_paise) values($1,'Bag',50,100) returning id",[product])).rows[0].id;
 await db.query('insert into inventory(variant_id,on_hand,reorder_level) values($1,10,5)',[variant]);
 await db.query('update inventory set on_hand=5 where variant_id=$1',[variant]);
 await db.query('update inventory set on_hand=4 where variant_id=$1',[variant]);
 assert.equal((await db.query("select count(*) n from commerce_private.admin_alerts where event='low_stock'")).rows[0].n,1);pass('low stock crossing alerts once while below threshold');
 await db.exec('begin');await db.query("insert into orders(customer_id,fulfillment,lines) values($1,'pickup','[]')",[customer]);await db.exec('rollback');
 assert.equal((await db.query("select count(*) n from commerce_private.admin_alerts where event='new_enquiry'")).rows[0].n,1);pass('business rollback removes queued event');
 await db.exec('delete from commerce_private.admin_alerts');
 await db.exec("insert into commerce_private.admin_alerts(event,dedupe_key) values('new_enquiry','fixture')");
 let j=(await worker('select admin_alert_claim() j')).rows[0].j;assert.equal(j.event,'new_enquiry');assert.equal((await worker('select admin_alert_claim() j')).rows[0].j,null);pass('single in-flight claim');
 await assert.rejects(worker("select admin_alert_finish($1,gen_random_uuid(),'sent','1',null)",[j.id]));pass('wrong lease rejected');
 await worker("select admin_alert_finish($1,$2,'rate_limited',null,10)",[j.id,j.lease_id]);assert.equal((await worker('select admin_alert_claim() j')).rows[0].j,null);pass('rate limit delays retry');
 for(let attempt=2;attempt<=3;attempt++){await db.exec("update commerce_private.admin_alert_pacing set next_claim_at=now()-interval '1 second'; update commerce_private.admin_alerts set available_at=now()-interval '1 second',leased_until=now()-interval '1 second'");j=(await worker('select admin_alert_claim() j')).rows[0].j;await worker("select admin_alert_finish($1,$2,'rate_limited',null,1)",[j.id,j.lease_id]);}
 assert.equal((await db.query("select state from commerce_private.admin_alerts where dedupe_key='fixture'")).rows[0].state,'failed');pass('three attempt ceiling');
 await db.exec("insert into commerce_private.admin_alerts(event,dedupe_key) values('low_stock','expire')");await db.exec("update commerce_private.admin_alert_pacing set next_claim_at=now()-interval '1 second'; update commerce_private.admin_alerts set leased_until=now()-interval '1 second'");j=(await worker('select admin_alert_claim() j')).rows[0].j;
 await db.exec("update commerce_private.admin_alerts set leased_until=now()-interval '1 second' where dedupe_key='expire'");assert.equal((await worker('select admin_alert_claim() j')).rows[0].j,null);assert.equal((await db.query("select state from commerce_private.admin_alerts where dedupe_key='expire'")).rows[0].state,'uncertain');pass('expired lease never replayed');
 await db.exec("begin; insert into commerce_private.admin_alerts(event,dedupe_key) values('low_stock','rollback'); rollback");assert.equal((await db.query("select count(*) n from commerce_private.admin_alerts where dedupe_key='rollback'")).rows[0].n,0);pass('queue transactional rollback');
 console.log(count+' checks passed');
}finally{await db.close()}
