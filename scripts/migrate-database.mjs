import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const directory = fileURLToPath(new URL('../neon/migrations/', import.meta.url));
const LOCK = 'SELECT pg_advisory_xact_lock(731294, 18402)';
const HISTORY = 'commerce_migrations.history';

// Refuse foreign or writable history before reading it or changing its ACLs.
// Column grants matter too: table-level ACL inspection alone misses UPDATE grants.
export const HISTORY_TRUST = `SELECT
 current_user = session_user
 AND NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_namespace n
  WHERE n.nspname = 'commerce_migrations' AND (
   n.nspowner <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
   OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a
    WHERE a.grantee <> n.nspowner AND a.privilege_type = 'CREATE')
  )
 )
 AND NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'commerce_migrations' AND c.relname = 'history' AND (
   c.relkind <> 'r'
   OR c.relowner <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
   OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    WHERE a.grantee <> c.relowner AND a.privilege_type <> 'SELECT')
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute att,
    LATERAL pg_catalog.aclexplode(att.attacl) a
    WHERE att.attrelid = c.oid AND a.grantee <> c.relowner AND a.privilege_type <> 'SELECT')
  )
 ) AS trusted`;

// Ignore quoted bodies/comments, but reject transaction control in top-level SQL.
function topLevel(sql) {
  return sql.replace(/\$(\w*)\$[\s\S]*?\$\1\$|'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
}
export function validateMigrations(migrations) {
  if (!Array.isArray(migrations) || !migrations.length) throw new Error('No migrations supplied');
  let previous = '';
  return migrations.map(({ name, sql }) => {
    if (typeof name !== 'string' || !/^\d{12,14}_[a-z0-9_]+\.sql$/.test(name) || name <= previous) throw new Error('Migration names must be unique and ordered');
    previous = name;
    if (typeof sql !== 'string' || !sql.trim() || Buffer.byteLength(sql) > 4 * 1024 * 1024) throw new Error('Invalid migration content');
    if (/(?:^|;)\s*(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION|VACUUM|CREATE\s+DATABASE|DROP\s+DATABASE)\b/i.test(topLevel(sql))) throw new Error('Migration contains forbidden transaction control');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}
export async function loadMigrations(dir = directory) {
  const entries = await readdir(dir, { withFileTypes: true });
  const names = entries.filter(e => e.name.endsWith('.sql')).sort((a,b) => a.name < b.name ? -1 : 1);
  if (names.some(e => !e.isFile())) throw new Error('Migration must be a regular file');
  return validateMigrations(await Promise.all(names.map(async e => ({name:e.name,sql:await readFile(resolve(dir,e.name),'utf8')}))));
}

/** Caller supplies an exclusive, idle connection, never a pool or an active transaction. */
export async function applyMigrations(client, input) {
  const migrations = validateMigrations(input);
  let began = false;
  try {
    await client.query('BEGIN'); began = true;
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query(LOCK);
    if ((await client.query(HISTORY_TRUST)).rows[0]?.trusted !== true) throw new Error('Untrusted migration history');
    await client.query('CREATE SCHEMA IF NOT EXISTS commerce_migrations');
    await client.query('REVOKE ALL ON SCHEMA commerce_migrations FROM PUBLIC');
    await client.query(`CREATE TABLE IF NOT EXISTS ${HISTORY} (position integer PRIMARY KEY CHECK(position > 0), name text UNIQUE NOT NULL, checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'), applied_at timestamptz NOT NULL DEFAULT now())`);
    // Recheck newly created objects too: owner default privileges may grant writes.
    if ((await client.query(HISTORY_TRUST)).rows[0]?.trusted !== true) throw new Error('Untrusted migration history');
    await client.query(`REVOKE ALL ON TABLE ${HISTORY} FROM PUBLIC`);
    const { rows } = await client.query(`SELECT position,name,checksum FROM ${HISTORY} ORDER BY position`);
    if (rows.length > migrations.length) throw new Error('Unknown migration history');
    for (let i=0;i<rows.length;i++) {
      if (rows[i].position !== i+1 || rows[i].name !== migrations[i].name || rows[i].checksum !== migrations[i].checksum) throw new Error('Changed, unknown, or non-prefix migration history');
    }
    const pending = migrations.slice(rows.length);
    for (let i=rows.length;i<migrations.length;i++) {
      await client.query(migrations[i].sql);
      await client.query(`INSERT INTO ${HISTORY}(position,name,checksum) VALUES($1,$2,$3)`,[i+1,migrations[i].name,migrations[i].checksum]);
    }
    await client.query('COMMIT'); began = false;
    return { applied: pending.map(m => m.name), previouslyApplied: rows.length };
  } catch {
    if (began) { try { await client.query('ROLLBACK'); } catch { /* Caller must discard this connection. */ } }
    // Never echo SQL/provider diagnostics. A commit transport error is ambiguous: rerun checks history.
    throw new Error('Migration not confirmed; connection discarded. Inspect migration history before retrying.');
  }
}
export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length !== 1 || argv[0] !== '--apply') throw new Error('Usage: node scripts/migrate-database.mjs --apply; requires MIGRATION_DATABASE_URL');
  if (!env.MIGRATION_DATABASE_URL?.trim()) throw new Error('MIGRATION_DATABASE_URL is required; no runtime or owner URL fallback');
  const url = new URL(env.MIGRATION_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Expected PostgreSQL migration connection');
  const migrations = await loadMigrations();
  const { Client } = await import('pg');
  const client = new Client({ connectionString: env.MIGRATION_DATABASE_URL, connectionTimeoutMillis: 10000 });
  try { await client.connect(); const result = await applyMigrations(client,migrations); console.log(`Applied ${result.applied.length} migrations; ${result.previouslyApplied} already recorded.`); }
  finally { await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Migration command failed; verify --apply, MIGRATION_DATABASE_URL and migration history. Provider details withheld.'); process.exitCode=1; });
}
