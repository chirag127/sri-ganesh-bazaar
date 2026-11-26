import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { RUNTIME_ROLE_CHECK } from '../../server/database.mjs';

let db;
beforeAll(async () => {
 db = new PGlite();
 await db.exec(`CREATE ROLE commerce_runtime; CREATE ROLE commerce_worker;
 CREATE ROLE safe_login LOGIN; GRANT commerce_runtime TO safe_login;
 CREATE ROLE owner_role; CREATE ROLE inherited_owner LOGIN NOINHERIT;
 GRANT commerce_runtime, owner_role TO inherited_owner;
 CREATE SCHEMA commerce_probe AUTHORIZATION owner_role;
 CREATE ROLE direct_owner LOGIN; GRANT commerce_runtime TO direct_owner;
 CREATE TABLE public.guard_probe (id integer); ALTER TABLE public.guard_probe OWNER TO direct_owner;
 CREATE ROLE privileged_role CREATEROLE; CREATE ROLE inherited_privilege LOGIN NOINHERIT;
 GRANT commerce_runtime, privileged_role TO inherited_privilege;
 CREATE ROLE worker_login LOGIN; GRANT commerce_runtime, commerce_worker TO worker_login;
 CREATE ROLE function_owner LOGIN; GRANT commerce_runtime TO function_owner;
 CREATE FUNCTION public.guard_fn() RETURNS integer LANGUAGE sql AS 'SELECT 1';
 ALTER FUNCTION public.guard_fn() OWNER TO function_owner;
 CREATE ROLE db_owner LOGIN; GRANT commerce_runtime TO db_owner;
 CREATE ROLE indirect_owner LOGIN NOINHERIT; GRANT inherited_owner TO indirect_owner;
 `);
});
afterAll(async () => { await db?.close(); });
async function check(role) {
 await db.exec(`SET SESSION AUTHORIZATION ${role}`);
 try { return (await db.query(RUNTIME_ROLE_CHECK)).rows[0].safe; }
 finally { await db.exec('RESET SESSION AUTHORIZATION'); }
}
describe('real PostgreSQL runtime privilege guard', () => {
 it('accepts a dedicated nonowning runtime login', async () => expect(await check('safe_login')).toBe(true));
 it.each(['inherited_owner','indirect_owner','direct_owner','function_owner','inherited_privilege','worker_login'])('rejects %s', async role => expect(await check(role)).toBe(false));
 it('rejects database ownership', async () => {
  const isolated = new PGlite();
  try {
   await isolated.exec('CREATE ROLE commerce_runtime; CREATE ROLE commerce_worker; CREATE ROLE db_owner LOGIN; GRANT commerce_runtime TO db_owner; ALTER DATABASE postgres OWNER TO db_owner; SET SESSION AUTHORIZATION db_owner');
   expect((await isolated.query(RUNTIME_ROLE_CHECK)).rows[0].safe).toBe(false);
  } finally { await isolated.close(); }
 });
});
