import { describe, it, expect, vi } from 'vitest';
import { createErrorReporter, sentryEndpoint } from '../../src/lib/error-reporting';
const dsn = 'https://0123456789abcdef0123456789abcdef@o123.ingest.us.sentry.io/123';
const uuid = () => '12345678-1234-4234-8234-123456789abc';
describe('private error reporting', () => {
  it('defaults off', async () => {
    const fetcher = vi.fn();
    expect(await createErrorReporter({ dsn, fetcher })()).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['', 'http://key@o1.ingest.sentry.io/1', dsn + '?private=1', dsn.replace('sentry.io', 'evil.test'), dsn.replace('/123', '/123/path'), dsn.replace('@', ':password@')])('rejects unsafe DSN %s', value => expect(sentryEndpoint(value)).toBeNull());
  it('sends only allowlisted generic data and never credentials/referrer', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    expect(await createErrorReporter({ enabled: true, dsn, fetcher, uuid })()).toBe(uuid().replaceAll('-', ''));
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://o123.ingest.us.sentry.io/api/123/envelope/');
    expect(options).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' });
    const [header, item, payload] = options.body.trim().split('\n').map(JSON.parse);
    expect(header.dsn).toBe(dsn);
    expect(item.length).toBe(new TextEncoder().encode(JSON.stringify(payload)).length);
    expect(payload).toEqual({ event_id: uuid().replaceAll('-', ''), message: 'APP_RENDER_FAILURE', level: 'error', platform: 'javascript' });
  });
  it('limits attempts including failed sends and never retries', async () => {
    let time = 0;
    const fetcher = vi.fn().mockRejectedValue(new Error('private error'));
    const report = createErrorReporter({ enabled: true, dsn, fetcher, uuid, now: () => time });
    for (let i = 0; i < 5; i++) { expect(await report()).toBeNull(); time += 60000; }
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('rate limits repeated render failures', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const report = createErrorReporter({ enabled: true, dsn, fetcher, uuid, now: () => 1 });
    await report(); expect(await report()).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('times out even when the transport ignores abort', async () => {
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    expect(await createErrorReporter({ enabled: true, dsn, fetcher, uuid, timeoutMs: 5 })()).toBeNull();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it('handles rejected HTTP responses and UUID failures safely', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false });
    expect(await createErrorReporter({ enabled: true, dsn, fetcher, uuid })()).toBeNull();
    expect(await createErrorReporter({ enabled: true, dsn, fetcher, uuid: () => { throw Error(); } })()).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
