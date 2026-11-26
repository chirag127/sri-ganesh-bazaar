import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicUrl, validatePublicBackendSettings } from '../../src/lib/public-config';
const state = vi.hoisted(() => ({ session: { user: { id: 'neon-user' }, access_token: 'test-jwt' } as any }));
vi.mock('@neon/auth', () => ({ createAuthClient: () => ({ getSession: async () => ({ data: {session: state.session}, error: null }) }) }));
vi.mock('@neon/auth/vanilla/adapters', () => ({ SupabaseAuthAdapter: () => ({}) }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); state.session = {user:{id:'neon-user'},access_token:'test-jwt'}; });
async function api() {
  vi.stubEnv('PUBLIC_COMMERCE_API_URL', 'https://api.example.com');
  vi.stubEnv('PUBLIC_NEON_AUTH_URL', 'https://auth.example.com/db/auth');
  return import('../../src/lib/api');
}
describe('Neon public endpoint boundaries', () => {
  it('preserves the managed Auth path', () => expect(validatePublicBackendSettings('https://api.example.com/', 'https://auth.example.com/db/auth').authUrl).toBe('https://auth.example.com/db/auth'));
  it.each(['postgres://u:p@host/db','http://api.example.com','https://u:p@host','https://host/?token=x','https://host/#x','https://host/path'])('rejects unsafe API endpoint %s', url => expect(() => publicUrl(url)).toThrow());
});
describe('Neon HTTP transport', () => {
  it('calls protected RPC with a bearer token and no cookies/cache', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({orders:[]})));
    vi.stubGlobal('fetch', fetcher);
    const client = await api();
    await client.getWorkspace();
    expect(fetcher).toHaveBeenCalledWith('https://api.example.com/rpc/customer_workspace', expect.objectContaining({method:'POST',credentials:'omit',cache:'no-store',redirect:'error',headers:expect.objectContaining({Authorization:'Bearer test-jwt'})}));
  });
  it('does not send a private request without a session', async () => {
    state.session = null;
    const fetcher = vi.fn(); vi.stubGlobal('fetch',fetcher);
    await expect((await api()).getWorkspace()).rejects.toThrow('Sign in');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves command dispatcher and idempotency payload', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({id:'saved'}))); vi.stubGlobal('fetch',fetcher);
    await (await api()).command('save_profile',{name:'Test'});
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.p_action).toBe('save_profile');
    expect(body.p_payload).toEqual({name:'Test',request_id:expect.any(String)});
  });
  it('never attaches credentials to the public catalog', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({products:[],configured:true}))); vi.stubGlobal('fetch',fetcher);
    await (await api()).getCatalog();
    expect(fetcher.mock.calls[0][0]).toBe('https://api.example.com/catalog');
    expect(fetcher.mock.calls[0][1].headers).toBeUndefined();
  });
  it('does not expose backend error bodies', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('private database diagnostics',{status:500})));
    await expect((await api()).getWorkspace()).rejects.toThrow('500');
  });
});
