const signatures = Object.freeze({
 catalog_snapshot: [], customer_workspace: [], admin_workspace: [],
 owner_analytics: ['date','date'],
 product_request_command: ['text','jsonb'], product_requests_page: ['boolean','integer','integer'],
 cart_estimate: ['jsonb','text'], estimate_settings_command: ['text','jsonb'],
 commerce_command: ['text','jsonb'], commerce_page: ['text','text','integer','integer'],
 customer_orders: ['integer','integer'], customer_order_detail: ['uuid'],
 admin_order_detail: ['uuid'], admin_customer_detail: ['uuid'],
 register_payment_evidence: ['text','uuid','integer','text'], payment_evidence_access: ['text'],
});
// MEMBER deliberately includes NOINHERIT memberships: a login that can SET ROLE
// to an owner is unsafe even when its initial effective permissions look limited.
export const RUNTIME_ROLE_CHECK = `
WITH reachable AS (
 SELECT oid, rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
 FROM pg_roles
 WHERE oid = (SELECT oid FROM pg_roles WHERE rolname = session_user)
    OR pg_has_role(session_user, oid, 'MEMBER')
), app_schemas AS (
 SELECT oid, nspowner FROM pg_namespace
 WHERE nspname = 'public' OR nspname LIKE 'commerce\\_%' ESCAPE '\\'
), owners AS (
 SELECT datdba AS owner FROM pg_database WHERE datname = current_database()
 UNION SELECT nspowner FROM app_schemas
 UNION SELECT relowner FROM pg_class WHERE relnamespace IN (SELECT oid FROM app_schemas)
 UNION SELECT proowner FROM pg_proc WHERE pronamespace IN (SELECT oid FROM app_schemas)
 UNION SELECT typowner FROM pg_type WHERE typnamespace IN (SELECT oid FROM app_schemas)
)
SELECT current_user = session_user
 AND pg_has_role(session_user, 'commerce_runtime', 'MEMBER')
 AND NOT EXISTS (
  SELECT 1 FROM reachable
  WHERE rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication
     OR rolname = 'commerce_worker' OR left(rolname, 3) = 'pg_'
 )
 AND NOT EXISTS (SELECT 1 FROM owners JOIN reachable ON owners.owner = reachable.oid)
 AS safe`;

export function createDatabase(pool) {
 async function transaction(identity, work) {
  const client = await pool.connect();
  let broken = false;
  try {
   await client.query('BEGIN');
   // Fail closed when deployment accidentally injects an owner or worker credential.
   const role = await client.query(RUNTIME_ROLE_CHECK);
   if (role.rows[0]?.safe !== true) throw new Error('Unsafe database role');
   let userId;
   if(identity) { const bound = await client.query('SELECT commerce_identity.begin_request($1::text,$2::text,$3::text,$4::boolean) AS id',[identity.subject,identity.email,identity.name,identity.email_verified]); userId=bound.rows[0].id; }
   const tx = { userId, async rpc(name,args=[]) {
    if(!Object.hasOwn(signatures,name) || args.length!==signatures[name].length) throw new Error('Unsupported database call');
    const placeholders=signatures[name].map((type,i)=>`$${i+1}::${type}`).join(',');
    const result=await client.query(`SELECT public.${name}(${placeholders}) AS data`,args.map((arg,i)=>signatures[name][i]==='jsonb'?JSON.stringify(arg):arg));
    return result.rows[0]?.data;
   }};
   const result=await work(tx); await client.query('COMMIT'); return result;
  } catch(error) { try { await client.query('ROLLBACK'); } catch { broken=true; } throw error; }
  finally { client.release(broken); }
 }
 return { withIdentity:transaction, catalog:()=>transaction(null,tx=>tx.rpc('catalog_snapshot')) };
}
