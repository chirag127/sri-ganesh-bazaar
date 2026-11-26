import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
const db = new PGlite();
try {
 await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create function auth.jwt() returns jsonb language sql as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$; grant usage on schema auth to anon,authenticated,service_role; grant execute on all functions in schema auth to anon,authenticated,service_role;`);
 const dir = new URL('../supabase/migrations/',import.meta.url);
 for (const file of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort()) {
  await db.exec(await readFile(new URL(file,dir),'utf8'));
  console.log(`PASS migration ${file}`);
 }
 await db.exec(`set role anon`);
 let denied=false;
 try { await db.query('select * from public.inventory'); } catch { denied=true; }
 if(!denied) throw new Error('Anonymous inventory access unexpectedly permitted');
 console.log('PASS anonymous inventory denied');
} finally { await db.close(); }
