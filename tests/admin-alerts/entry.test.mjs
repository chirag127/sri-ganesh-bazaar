import { afterEach, describe, expect, it, vi } from 'vitest';
import entry, { createAdminAlertHandler } from '../../server/admin-alert-entry.mjs';
const secret = 'a'.repeat(64);
const request = (options = {}) => new Request('https://worker.example/', { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, ...options });
afterEach(() => vi.unstubAllEnvs());
describe('scheduler HTTP boundary', () => {
  it.each(['GET', 'OPTIONS', 'PUT', 'DELETE'])('rejects %s without invoking worker', async method => {
    const worker = vi.fn(); const response = await createAdminAlertHandler({enabled:true,secret,worker}).fetch(request({method}));
    expect(response.status).toBe(405); expect(response.headers.get('allow')).toBe('POST'); expect(worker).not.toHaveBeenCalled();
  });
  it.each([undefined, false, 'true'])('is disabled unless explicitly true: %s', async enabled => {
    const worker=vi.fn(); expect((await createAdminAlertHandler({enabled,secret,worker}).fetch(request())).status).toBe(503); expect(worker).not.toHaveBeenCalled();
  });
  it.each([undefined, '', 'short', 'a'.repeat(257), ' '.repeat(64)])('rejects invalid configured secrets', async value => {
    const worker=vi.fn(); expect((await createAdminAlertHandler({enabled:true,secret:value,worker}).fetch(request())).status).toBe(503); expect(worker).not.toHaveBeenCalled();
  });
  it.each(['', 'Basic token', `Bearer ${'b'.repeat(64)}`, `Bearer ${'a'.repeat(300)}`, `Bearer  ${secret}`])('rejects invalid authorization', async authorization => {
    const worker=vi.fn(); expect((await createAdminAlertHandler({enabled:true,secret,worker}).fetch(request({headers:{Authorization:authorization}}))).status).toBe(401); expect(worker).not.toHaveBeenCalled();
  });
  it('rejects payloads without consuming them', async () => {
    const worker=vi.fn(); const r=request({body:'{}'}); expect((await createAdminAlertHandler({enabled:true,secret,worker}).fetch(r)).status).toBe(413); expect(r.bodyUsed).toBe(false); expect(worker).not.toHaveBeenCalled();
  });
  it('rejects browser origins and never supplies CORS', async () => {
    const worker=vi.fn(); const r=request({headers:{Authorization:`Bearer ${secret}`,Origin:'https://shop.example'}});
    const response=await createAdminAlertHandler({enabled:true,secret,worker}).fetch(r); expect(response.status).toBe(403); expect(response.headers.get('access-control-allow-origin')).toBeNull(); expect(worker).not.toHaveBeenCalled();
  });
  it.each(['idle','sent','failed','uncertain','rate_limited','disabled'])('returns only safe outcome %s', async state => {
    const worker=vi.fn(async()=>({state,secret:'private'})); const response=await createAdminAlertHandler({enabled:true,secret,worker}).fetch(request());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({state}); expect(response.headers.get('cache-control')).toBe('no-store'); expect(worker).toHaveBeenCalledTimes(1);
  });
  it('sanitizes failures and never retries', async () => {
    const worker=vi.fn(async()=>{throw new Error('private credential');}); const response=await createAdminAlertHandler({enabled:true,secret,worker}).fetch(request());
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('credential'); expect(worker).toHaveBeenCalledTimes(1);
  });
  it('rejects unknown worker outcomes', async()=>expect((await createAdminAlertHandler({enabled:true,secret,worker:async()=>({state:'secret'})}).fetch(request())).status).toBe(503));
  it('default export remains off without configuration', async()=>{
    vi.stubEnv('ENABLE_TELEGRAM_ALERTS','false'); expect((await entry.fetch(request())).status).toBe(503);
  });
  it('default export cannot fall back to owner database URL', async()=>{
    vi.stubEnv('ENABLE_TELEGRAM_ALERTS','true'); vi.stubEnv('NOTIFICATION_WORKER_SECRET',secret); vi.stubEnv('COMMERCE_WORKER_DATABASE_URL',''); vi.stubEnv('DATABASE_URL','postgres://must-not-connect');
    expect((await entry.fetch(request())).status).toBe(503);
  });
});
