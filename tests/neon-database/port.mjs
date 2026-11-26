import {readFile,mkdir,writeFile} from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
await mkdir(new URL('neon/migrations/',root),{recursive:true});
for(const name of ['001_commerce_schema','002_commerce_helpers','003_commerce_commands','004_commerce_reads','005_support']) {
 let sql=await readFile(new URL(`supabase/migrations/202611230${name}.sql`,root),'utf8');
 sql=sql.replaceAll('auth.users','commerce_identity.users').replaceAll('auth.uid()','commerce_identity.uid()').replaceAll('auth.jwt()','commerce_identity.claims()');
 sql=sql.replace(/\banon\b/g,'commerce_guest').replace(/\bauthenticated\b/g,'commerce_runtime').replace(/\bservice_role\b/g,'commerce_worker');
 await writeFile(new URL(`neon/migrations/202611230${name}.sql`,root),sql);
}
