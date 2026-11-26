import { describe, it, expect, vi } from 'vitest';
import { createApi } from '../../server/api.mjs';

const id = '00000000-0000-4000-8000-000000000001';
function fixture() {
  const rpc = vi.fn(async () => ({ ok: true }));
  const database = { catalog: vi.fn(async () => ({ products: [] })), withIdentity: vi.fn(async (_, work) => work({ userId: id, rpc })) };
  const storage = { put: vi.fn(async () => {}), url: vi.fn(async () => 'https://example.test/file') };
  const verifyToken = vi.fn(async () => ({ subject: 'trusted', email_verified: true }));
  return { rpc, database, storage, verifyToken, api: createApi({ database, storage, verifyToken, origins: ['https://shop.test'], uuid: () => id }) };
}
function request(path, body = '{}', headers = {}) {
  return new Request('https://api.test' + path, { method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json', ...headers }, body });
}
function upload() {
  return request('/evidence/upload?order_id=' + id, new Uint8Array([137,80,78,71,13,10,26,10]));
}

describe('HTTP rejection and failure side effects', () => {
  it.each(['{', 'null', '[]', '42'])('rejects malformed RPC body %s before database access', async body => {
    const f = fixture();
    expect((await f.api.fetch(request('/rpc/customer_workspace', body))).status).toBe(400);
    expect(f.database.withIdentity).not.toHaveBeenCalled();
  });
  it('rejects missing RPC arguments', async () => {
    const f = fixture();
    expect((await f.api.fetch(request('/rpc/customer_order_detail'))).status).toBe(400);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('rejects non-JSON RPC content', async () => {
    const f = fixture();
    expect((await f.api.fetch(request('/rpc/customer_workspace', '{}', { 'content-type': 'text/plain' }))).status).toBe(415);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([null, { subject: 'trusted', email_verified: false }, { email_verified: true }])('rejects incomplete verified identities', async identity => {
    const f = fixture(); f.verifyToken.mockResolvedValue(identity);
    expect((await f.api.fetch(request('/rpc/customer_workspace'))).status).toBe(401);
    expect(f.database.withIdentity).not.toHaveBeenCalled();
  });
  it('handles preflight without authentication or database work', async () => {
    const f = fixture();
    const response = await f.api.fetch(new Request('https://api.test/rpc/customer_workspace', { method: 'OPTIONS', headers: { origin: 'https://shop.test' } }));
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://shop.test');
    expect(f.verifyToken).not.toHaveBeenCalled();
    expect(f.database.withIdentity).not.toHaveBeenCalled();
  });
  it('does not upload evidence when order authorization fails', async () => {
    const f = fixture(); f.rpc.mockRejectedValue(new Error('private-order-detail'));
    const response = await f.api.fetch(upload());
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('private-order-detail');
    expect(f.storage.put).not.toHaveBeenCalled();
  });
  it('does not register evidence when object storage fails', async () => {
    const f = fixture(); f.storage.put.mockRejectedValue(new Error('private-storage-credential'));
    const response = await f.api.fetch(upload());
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('private-storage-credential');
    expect(f.rpc.mock.calls.map(call => call[0])).toEqual(['customer_order_detail']);
  });
  it('rejects unsupported image bytes before transaction or storage', async () => {
    const f = fixture();
    expect((await f.api.fetch(request('/evidence/upload?order_id=' + id, 'not-an-image'))).status).toBe(415);
    expect(f.database.withIdentity).not.toHaveBeenCalled();
    expect(f.storage.put).not.toHaveBeenCalled();
  });
  it('rejects oversized uploads before storage', async () => {
    const f = fixture();
    expect((await f.api.fetch(request('/evidence/upload?order_id=' + id, new Uint8Array(2097153)))).status).toBe(413);
    expect(f.storage.put).not.toHaveBeenCalled();
  });
  it('rejects traversal in evidence paths before authorization lookup', async () => {
    const f = fixture();
    expect((await f.api.fetch(request('/evidence/url', JSON.stringify({ path: '../secret.png' })))).status).toBe(400);
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.storage.url).not.toHaveBeenCalled();
  });
  it('returns non-cacheable sanitized catalog failures', async () => {
    const f = fixture(); f.database.catalog.mockRejectedValue(new Error('postgres://secret'));
    const response = await f.api.fetch(new Request('https://api.test/catalog'));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).not.toContain('postgres://secret');
  });
});
