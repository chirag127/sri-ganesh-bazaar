import { RUNTIME_ROLE_CHECK } from './database.mjs';

// Reuse the ownership/privileged-membership checks, reversing only application roles.
export const WORKER_ROLE_CHECK = RUNTIME_ROLE_CHECK.replaceAll('commerce_runtime', '__runtime__').replaceAll('commerce_worker', 'commerce_runtime').replaceAll('__runtime__', 'commerce_worker');
export function createAdminAlertDatabase(pool) {
  async function run(sql, args = []) {
    const client = await pool.connect(); let broken = false;
    try {
      await client.query('BEGIN');
      if ((await client.query(WORKER_ROLE_CHECK)).rows[0]?.safe !== true) throw new Error('Unsafe worker database role');
      const result = await client.query(sql, args);
      await client.query('COMMIT'); return result.rows[0]?.data;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { broken = true; }
      throw error;
    } finally { client.release(broken); }
  }
  return {
    claim: () => run('SELECT public.admin_alert_claim() AS data'),
    finish: (job, outcome) => run('SELECT public.admin_alert_finish($1::uuid,$2::uuid,$3::text,$4::text,$5::integer) AS data', [job.id, job.lease_id, outcome.state, outcome.provider_id ?? null, outcome.retry_after ?? null]),
  };
}
/** One job per invocation. Schedule subsequent invocations; never loop or replay ambiguous sends. */
export function createAdminAlertWorker({ database, transport, enabled = false }) {
  return async () => {
    if (!enabled) return { state: 'disabled' };
    const job = await database.claim();
    if (!job) return { state: 'idle' };
    let outcome;
    try { outcome = await transport.send(job.event); } catch { outcome = { state: 'uncertain' }; }
    if (outcome?.reason === 'rate_limited') {
      const delay = outcome.retry_after;
      outcome = Number.isSafeInteger(delay) && delay >= 1 && delay <= 86400
        ? { state: 'rate_limited', retry_after: delay } : { state: 'failed' };
    } else if (outcome?.state === 'sent' && /^[0-9]{1,30}$/.test(outcome.provider_id ?? '')) {
      outcome = { state: 'sent', provider_id: outcome.provider_id };
    } else outcome = { state: outcome?.state === 'failed' ? 'failed' : 'uncertain' };
    // A failed/ambiguous finish must never cause another send. Lease expiry becomes uncertain.
    await database.finish(job, outcome);
    return { state: outcome.state };
  };
}
