import { Backend } from '../_shared/backend.ts';
import { allowedOrigins, corsHeaders, failure, HttpError, json, preflight, record, secretMatches, timedFetch, boundedJson, type Environment, type Fetcher } from '../_shared/http.ts';
import { encodeBase64Url } from '../_shared/firebase-proof.ts';

export function outcome(status: number, providerId: unknown): 'sent' | 'failed' | 'uncertain' {
  if (status >= 200 && status < 300 && typeof providerId === 'string' && providerId.length > 0) return 'sent';
  return status >= 400 && status < 500 && status !== 408 ? 'failed' : 'uncertain';
}
async function accessToken(env: Environment, fetcher: Fetcher) {
  const account = record(JSON.parse(env('FIREBASE_SERVICE_ACCOUNT_JSON') ?? '{}'));
  if (typeof account.client_email !== 'string' || typeof account.private_key !== 'string' || account.project_id !== env('FIREBASE_PROJECT_ID')) throw new HttpError(503, 'push_configuration_required');
  const pem = account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const encode = (value: unknown) => encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  const now = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  const response = await timedFetch(fetcher, 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${encodeBase64Url(new Uint8Array(signature))}` }) });
  const data = record(await boundedJson(response));
  if (!response.ok || typeof data.access_token !== 'string') throw new HttpError(503, 'push_authorization_failed');
  return data.access_token;
}
export function createNotificationHandler(env: Environment, fetcher: Fetcher = fetch) {
  return async (request: Request): Promise<Response> => {
    let headers: Headers | undefined;
    try {
      headers = corsHeaders(request, allowedOrigins(env('ALLOWED_ORIGINS')), true);
      const options = preflight(request, headers); if (options) return options;
      if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      if (!await secretMatches(request.headers.get('x-worker-secret'), env('NOTIFICATION_WORKER_SECRET'))) throw new HttpError(401, 'worker_authentication_required');
      if (env('ENABLE_NOTIFICATIONS') !== 'true') throw new HttpError(503, 'notifications_disabled');
      const backend = new Backend(env, fetcher);
      const rows = await backend.rpc('notification_claim', { p_limit: 10 });
      if (!Array.isArray(rows) || rows.length > 10) throw new HttpError(503, 'invalid_claim');
      const counts = { sent: 0, failed: 0, uncertain: 0 };
      let oauth: string | undefined;
      for (const value of rows) {
        const job = record(value);
        let state: 'sent' | 'failed' | 'uncertain' = 'failed', providerId: string | null = null;
        try {
          let response: Response;
          if (job.attempts !== 1) throw new Error('invalid_attempt');
          if (job.channel === 'email') {
            if (!env('BREVO_API_KEY') || !env('MAIL_FROM_EMAIL') || typeof job.email !== 'string') throw new Error('email_configuration_required');
            state = 'uncertain';
            response = await timedFetch(fetcher, 'https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': env('BREVO_API_KEY')!, 'Content-Type': 'application/json' }, body: JSON.stringify({ sender: { email: env('MAIL_FROM_EMAIL'), name: env('MAIL_FROM_NAME') || 'Shop updates' }, to: [{ email: job.email }], subject: 'An update is available', textContent: 'Sign in to the shop app to view your update.', headers: { IdempotencyKey: String(job.id) } }) });
          } else if (job.channel === 'push') {
            if (!Array.isArray(job.tokens) || job.tokens.length !== 1) throw new Error('invalid_destination');
            const target = record(job.tokens[0]);
            if (typeof target.token !== 'string' || target.token.length > 4096 || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(env('FIREBASE_PROJECT_ID') ?? '')) throw new Error('invalid_destination');
            oauth ??= await accessToken(env, fetcher);
            state = 'uncertain';
            response = await timedFetch(fetcher, `https://fcm.googleapis.com/v1/projects/${env('FIREBASE_PROJECT_ID')}/messages:send`, { method: 'POST', headers: { Authorization: `Bearer ${oauth}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { token: target.token, notification: { title: 'Shop update', body: 'Sign in to view your update.' }, android: { notification: { visibility: 'PRIVATE', tag: String(job.id) } }, webpush: { headers: { TTL: '300' }, notification: { tag: String(job.id) } } } }) });
          } else throw new Error('invalid_channel');
          const result = record(await boundedJson(response));
          const id = job.channel === 'email' ? result.messageId : result.name;
          state = outcome(response.status, id);
          providerId = state === 'sent' ? String(id).slice(0, 512) : null;
        } catch { /* Never replay an ambiguous provider send; SQL leases also terminate uncertain. */ }
        await backend.rpc('notification_finish', { p_job_id: job.id, p_state: state, p_provider_id: providerId, p_error: state === 'sent' ? null : 'delivery_not_confirmed' });
        counts[state]++;
      }
      return json(counts, 200, headers);
    } catch (error) { return failure(error, headers); }
  };
}
