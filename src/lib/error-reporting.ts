/** Minimal Sentry envelope transport: https://develop.sentry.dev/sdk/envelopes/ */
export function sentryEndpoint(value: unknown): { endpoint: string; dsn: string } | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    // Only hosted Sentry ingestion; never send browser data to arbitrary DSN hosts.
    if (url.protocol !== 'https:' || url.password || url.port || url.search || url.hash ||
      !/^[a-f0-9]{32}$/i.test(url.username) ||
      !/^(?:[a-z0-9-]+\.)*ingest(?:\.[a-z0-9-]+)?\.sentry\.io$/i.test(url.hostname) ||
      !/^\/[1-9][0-9]*$/.test(url.pathname)) return null;
    return { endpoint: `${url.origin}/api${url.pathname}/envelope/`, dsn: url.href };
  } catch { return null; }
}

type Options = {
  enabled?: boolean; dsn?: unknown; fetcher?: typeof fetch;
  now?: () => number; uuid?: () => string; timeoutMs?: number;
};
export function createErrorReporter({ enabled = false, dsn, fetcher = globalThis.fetch,
  now = Date.now, uuid = () => crypto.randomUUID(), timeoutMs = 3000 }: Options = {}) {
  const destination = sentryEndpoint(dsn);
  let attempts = 0;
  let last = -Infinity;
  return async (): Promise<string | null> => {
    if (!enabled || !destination || typeof fetcher !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const time = now();
      if (!Number.isFinite(time) || attempts >= 3 || time - last < 60000) return null;
      const reference = uuid().replaceAll('-', '');
      if (!/^[a-f0-9]{32}$/i.test(reference)) return null;
      attempts++; last = time;
      // No exception, stack, URL, referrer, user, breadcrumb, or arbitrary properties accepted.
      const payload = JSON.stringify({ event_id: reference, message: 'APP_RENDER_FAILURE', level: 'error', platform: 'javascript' });
      const envelope = `${JSON.stringify({ event_id: reference, dsn: destination.dsn })}\n${JSON.stringify({ type: 'event', content_type: 'application/json', length: new TextEncoder().encode(payload).length })}\n${payload}\n`;
      const controller = new AbortController();
      const deadline = new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs); });
      const send = Promise.resolve().then(() => fetcher(destination.endpoint, {
        method: 'POST', body: envelope, headers: { 'Content-Type': 'application/x-sentry-envelope' },
        credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error', signal: controller.signal,
      })).then(response => response.ok ? reference : null, () => null);
      return await Promise.race([send, deadline]);
    } catch { return null; }
    finally { if (timer !== undefined) clearTimeout(timer); }
  };
}

const report = createErrorReporter({
  enabled: import.meta.env.PUBLIC_ENABLE_SENTRY === 'true', dsn: import.meta.env.PUBLIC_SENTRY_DSN,
});
export function reportRenderFailure(): Promise<string | null> { return report(); }
