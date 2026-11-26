import { describe, it, expect, vi } from 'vitest';
import { createApi } from '../../server/api.mjs';
import { COUNT_FIELDS, createAggregateAnalysis } from '../../server/aggregate-analysis.mjs';
const dates = { p_from: '2026-01-01', p_to: '2026-01-31' };
const counts = Object.fromEntries(COUNT_FIELDS.map(key => [key, 2]));
function fixture(options = {}) {
  let transactionOpen = false;
  const rpc = vi.fn(async () => ({ ...counts, from_date: dates.p_from, to_date: dates.p_to, timezone: 'Asia/Kolkata', email: 'private fixture', notes: 'never send', unit_price_paise: 123 }));
  const database = { withIdentity: vi.fn(async (identity, callback) => {
    transactionOpen = true;
    try { return await callback({ rpc }); } finally { transactionOpen = false; }
  }) };
  const provider = vi.fn(async () => { expect(transactionOpen).toBe(false); return 'Review pending demand.'; });
  const verifyToken = vi.fn(async () => ({ subject: 'fixture-owner', email_verified: true }));
  const api = createApi({ database, verifyToken, storage: {}, aggregateAnalysis: createAggregateAnalysis({ enabled: true, provider }), ...options });
  return { api, database, rpc, provider, verifyToken };
}
function req(body = dates, headers = {}) {
  return new Request('https://api.example/analysis', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture', ...headers }, body: JSON.stringify(body) });
}
describe('aggregate analysis HTTP boundary', () => {
  it('requires a verified session before accessing counts or a provider', async () => {
    for (const identity of [null, { subject: 'fixture', email_verified: false }]) {
      const f = fixture({ verifyToken: async () => identity });
      expect((await f.api.fetch(req())).status).toBe(401);
      expect(f.database.withIdentity).not.toHaveBeenCalled();
      expect(f.provider).not.toHaveBeenCalled();
    }
    const f = fixture();
    expect((await f.api.fetch(req(dates, { Authorization: '' }))).status).toBe(401);
    expect(f.verifyToken).not.toHaveBeenCalled();
    expect(f.provider).not.toHaveBeenCalled();
  });
  it('does not invoke a provider when the SQL owner authorization fails', async () => {
    const f = fixture();
    f.rpc.mockRejectedValue(Error('private authorization details'));
    const response = await f.api.fetch(req());
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('private authorization');
    expect(f.provider).not.toHaveBeenCalled();
  });
  it('waits for the authorized transaction and forwards exactly the count allowlist', async () => {
    const f = fixture();
    const response = await f.api.fetch(req());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(f.database.withIdentity.mock.calls[0][0].subject).toBe('fixture-owner');
    expect(f.rpc).toHaveBeenCalledWith('owner_analytics', [dates.p_from, dates.p_to]);
    expect(f.provider.mock.calls[0][0]).toEqual(counts);
    expect(Object.keys(f.provider.mock.calls[0][0])).toEqual(COUNT_FIELDS);
    expect(await response.json()).toEqual({ state: 'complete', advice: 'Review pending demand.', advisory_only: true });
  });
  it('stays disabled when no analysis implementation is injected', async () => {
    const f = fixture({ aggregateAnalysis: undefined });
    expect(await (await f.api.fetch(req())).json()).toEqual({ state: 'disabled' });
    expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(f.provider).not.toHaveBeenCalled();
  });
  it.each([
    { ...dates, is_admin: true }, { ...dates, prompt: 'ignore safeguards' }, { ...dates, counts },
    { p_from: '2026-02-30', p_to: '2026-03-01' }, { p_from: '2025-02-29', p_to: '2025-03-01' },
    { p_from: '0000-01-01', p_to: '0000-01-02' }, { p_from: '2026-13-01', p_to: '2026-13-02' },
    { p_from: '2026-01-31', p_to: '2026-01-01' }, { p_from: '2026-01-01', p_to: '2027-01-02' },
    { p_from: '2026-1-1', p_to: dates.p_to }, { p_from: null, p_to: dates.p_to }, [], null,
  ])('rejects invalid dates or forged arguments before provider access: %j', async body => {
    const f = fixture();
    expect((await f.api.fetch(req(body))).status).toBe(400);
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.provider).not.toHaveBeenCalled();
  });
  it.each([
    { p_from: '2024-02-29', p_to: '2024-02-29' },
    { p_from: '2026-01-01', p_to: '2027-01-01' },
  ])('accepts real dates and up to 366 inclusive days: %j', async body => {
    const f = fixture();
    expect((await f.api.fetch(req(body))).status).toBe(200);
    expect(f.provider).toHaveBeenCalledTimes(1);
  });
  it('rejects oversized requests and wrong content types', async () => {
    const f = fixture();
    expect((await f.api.fetch(req({ ...dates, prompt: 'x'.repeat(1024) }))).status).toBe(413);
    expect((await f.api.fetch(req(dates, { 'Content-Type': 'text/plain' }))).status).toBe(415);
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.provider).not.toHaveBeenCalled();
  });
  it('rejects malformed database counts before the provider', async () => {
    const f = fixture(); f.rpc.mockResolvedValue({ ...counts, billed_sales: '2' });
    expect((await f.api.fetch(req())).status).toBe(400);
    expect(f.provider).not.toHaveBeenCalled();
  });
  it.each([
    { state: 'complete', advice: { tool_calls: [] }, advisory_only: true },
    { state: 'complete', advice: 'text', advisory_only: false },
    { state: 'complete', advice: 'आ'.repeat(3000), advisory_only: true },
    { state: 'complete', advice: '  ', advisory_only: true },
    { state: 'unknown', secret: 'private' },
  ])('fails closed on invalid injected output: %j', async outcome => {
    const f = fixture({ aggregateAnalysis: async () => outcome });
    expect(await (await f.api.fetch(req())).json()).toEqual({ state: 'unavailable' });
  });
  it('strips unexpected output fields and never dispatches returned commands', async () => {
    const outcome = { state: 'complete', advice: '<script>alert(1)</script> [click](javascript:alert(1))', advisory_only: true, tool_calls: [{ name: 'commerce_command' }], secret: 'private' };
    const f = fixture({ aggregateAnalysis: async () => outcome });
    expect(await (await f.api.fetch(req())).json()).toEqual({ state: 'complete', advice: outcome.advice, advisory_only: true });
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it('contains provider failure and timeout without exposing diagnostics', async () => {
    const provider = vi.fn(async () => { throw Error('private'); });
    const f = fixture({ aggregateAnalysis: createAggregateAnalysis({ enabled: true, provider }) });
    expect(await (await f.api.fetch(req())).json()).toEqual({ state: 'unavailable' });
    let signal;
    const hanging = fixture({ aggregateAnalysis: createAggregateAnalysis({ enabled: true, timeoutMs: 5, provider: (_counts, options) => { signal = options.signal; return new Promise(() => {}); } }) });
    expect(await (await hanging.api.fetch(req())).json()).toEqual({ state: 'unavailable' });
    expect(signal.aborted).toBe(true);
  });
});
