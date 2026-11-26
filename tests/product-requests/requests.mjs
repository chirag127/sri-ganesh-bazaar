import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const db = new PGlite();
let passed = 0;
const check = name => { passed++; console.log(`PASS ${name}`); };
async function as(subject, work) {
  await db.exec('set session authorization request_runtime; begin');
  try { await db.query('select commerce_identity.begin_request($1,$2,$1,true)', [subject,`${subject}@example.invalid`]); const result=await work(); await db.exec('commit'); return result; }
  catch(error) { await db.exec('rollback'); throw error; }
  finally { await db.exec('set session authorization postgres'); }
}
const command=(action,payload)=>db.query('select product_request_command($1,$2::jsonb) result',[action,JSON.stringify(payload)]);
const page=(admin=false,limit=20,offset=0)=>db.query('select product_requests_page($1,$2,$3) result',[admin,limit,offset]);
try {
 const dir=new URL('../../neon/migrations/',import.meta.url);
 for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file,dir),'utf8'));
 await db.exec('create role request_runtime login; grant commerce_runtime to request_runtime');
 const owner=(await as('owner',()=>db.query('select commerce_identity.uid() id'))).rows[0].id;
 await db.query('insert into admins(user_id) values($1)',[owner]);
 const payload={request_id:randomUUID(),description:'गेहूँ का चोकर — 10 bags चाहिए'};
 const created=(await as('buyer',()=>command('create',payload))).rows[0].result;
 await as('buyer',()=>command('create',payload));
 let own=(await as('buyer',()=>page())).rows[0].result;
 assert.equal(own.total,1); assert.equal(own.items[0].description,payload.description); check('Unicode and idempotent creation');
 assert.equal((await as('other',()=>page())).rows[0].result.total,0); check('customer isolation');
 await assert.rejects(as('buyer',()=>page(true)),/Administrator/); check('admin listing denied to customer');
 await assert.rejects(as('buyer',()=>command('update',{request_id:randomUUID(),id:created.id,status:'resolved',resolution:'done'})),/Administrator/); check('customer cannot resolve requests');
 await assert.rejects(as('buyer',()=>command('create',{...payload,description:'changed'})),/already used/); check('idempotency collision denied');
 for(const description of ['', 'x'.repeat(2001)]) await assert.rejects(as('buyer',()=>command('create',{request_id:randomUUID(),description}))); check('input bounds');
 await assert.rejects(as('buyer',()=>command('create',{request_id:randomUUID(),description:'feed',customer_id:owner}))); check('forged customer denied');
 for(const args of [[false,51,0],[false,20,-1],[null,20,0]]) await assert.rejects(as('buyer',()=>page(...args))); check('pagination bounds');
 const update={request_id:randomUUID(),id:created.id,status:'resolved',resolution:'दुकान से संपर्क करें'};
 await as('owner',()=>command('update',update)); await as('owner',()=>command('update',update));
 own=(await as('buyer',()=>page())).rows[0].result;
 assert.equal(own.items[0].status,'resolved'); assert.equal(own.items[0].resolution,update.resolution);
 assert.equal(Number((await db.query("select count(*) n from audit_log where action='product_request_update'")).rows[0].n),1); check('audited owner resolution');
 assert.equal((await as('owner',()=>page(true))).rows[0].result.total,1); check('owner sees pending demand');
 for(const table of ['orders','inventory','ledger_entries','bills']) assert.equal(Number((await db.query(`select count(*) n from ${table}`)).rows[0].n),0); check('requests never create stock or money records');
 await db.exec('set session authorization request_runtime'); await assert.rejects(db.query('select * from product_requests')); await db.exec('set session authorization postgres'); check('direct table access denied');
 console.log(`${passed} checks passed`);
} finally { await db.close(); }
