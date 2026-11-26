import { createHash, timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';
import { attachDatabasePool } from '@neon/functions';
import { createAdminAlertDatabase, createAdminAlertWorker } from './admin-alert-worker.mjs';
import { createTelegramTransport } from './telegram.mjs';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (body, status, extra = {}) => Response.json(body, { status, headers: { ...headers, ...extra } });
const strongSecret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(value);
const digest = value => createHash('sha256').update(value).digest();

/** Scheduler-only endpoint. Empty bodies only; authentication precedes worker initialization. */
export function createAdminAlertHandler({ enabled = false, secret, worker } = {}) {
  return { async fetch(request) {
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
    if (enabled !== true || !strongSecret(secret)) return reply({ error: 'Worker unavailable' }, 503);
    const authorization = request.headers.get('authorization') ?? '';
    if (authorization.length > 263 || !authorization.startsWith('Bearer ') ||
      !timingSafeEqual(digest(authorization.slice(7)), digest(secret))) {
      return reply({ error: 'Unauthorized' }, 401);
    }
    // Reject a stream without reading it: scheduler requests require no payload.
    const length = request.headers.get('content-length');
    if (request.body !== null || (length !== null && length !== '0')) return reply({ error: 'Request body not allowed' }, 413);
    if (request.headers.has('origin')) return reply({ error: 'Browser requests not allowed' }, 403);
    try {
      const result = await worker();
      if (!['idle', 'sent', 'failed', 'uncertain', 'rate_limited', 'disabled'].includes(result?.state)) throw new Error('Invalid outcome');
      return reply({ state: result.state }, 200);
    } catch {
      // A failed finish may follow a successful send. Never retry delivery here.
      return reply({ error: 'Worker operation unconfirmed' }, 503);
    }
  } };
}

let worker;
function configuredWorker() {
  if (worker) return worker;
  const connectionString = process.env.COMMERCE_WORKER_DATABASE_URL;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!connectionString || !/^[1-9][0-9]{4,19}:[A-Za-z0-9_-]{30,100}$/.test(token ?? '') || !/^-?[1-9][0-9]{0,19}$/.test(chatId ?? '')) throw new Error('Missing worker configuration');
  // Never use DATABASE_URL or COMMERCE_DATABASE_URL as a fallback.
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
  attachDatabasePool(pool, { onUnexpectedError: () => {} });
  worker = createAdminAlertWorker({ database: createAdminAlertDatabase(pool), transport: createTelegramTransport({ enabled: true, token, chatId }), enabled: true });
  return worker;
}
export default { fetch(request) {
  return createAdminAlertHandler({
    enabled: process.env.ENABLE_TELEGRAM_ALERTS === 'true',
    secret: process.env.NOTIFICATION_WORKER_SECRET,
    worker: () => configuredWorker()(),
  }).fetch(request);
} };
