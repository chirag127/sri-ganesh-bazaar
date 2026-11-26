import { describe, it, expect, vi } from 'vitest';
import { createApi } from '../../server/api.mjs';
const id = '00000000-0000-4000-8000-000000000001';
function fixture() {
  const rpc = vi.fn(async () => ({ id, request_id: id }));
  const database = { withIdentity: vi.fn(async (_, work) => work({ rpc })), catalog: vi.fn() };
  const api = createApi({ database, storage: {}, verifyToken: async () => ({subject:'buyer',email_verified:true}) });
  const send = (name, body, auth = true) => api.fetch(new Request(`https://api.example/rpc/${name}`, {method:'POST',headers:{'Content-Type':'application/json',...(auth ? {Authorization:'Bearer fixture'} : {})},body:JSON.stringify(body)}));
  return {rpc,database,send};
}
describe('private product request routes', () => {
  it('requires authentication for listing and writing', async () => {
    const f=fixture();
    for (const name of ['product_requests_page','product_request_command']) expect((await f.send(name,{},false)).status).toBe(401);
    expect(f.database.withIdentity).not.toHaveBeenCalled();
  });
  it('dispatches bounded listing arguments in signature order', async () => {
    const f=fixture();
    expect((await f.send('product_requests_page',{p_admin:false,p_limit:20,p_offset:0})).status).toBe(200);
    expect(f.rpc).toHaveBeenCalledWith('product_requests_page',[false,20,0]);
  });
  it('requires a request UUID before dispatching writes', async () => {
    const f=fixture();
    expect((await f.send('product_request_command',{p_action:'create',p_payload:{description:'चोकर'}})).status).toBe(400);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('preserves Unicode in the authenticated command', async () => {
    const f=fixture(), payload={request_id:id,description:'चोकर — 10 bags'};
    expect((await f.send('product_request_command',{p_action:'create',p_payload:payload})).status).toBe(200);
    expect(f.rpc).toHaveBeenCalledWith('product_request_command',['create',payload]);
  });
  it('rejects injected top-level identity arguments', async () => {
    const f=fixture();
    expect((await f.send('product_requests_page',{p_admin:false,p_limit:20,p_offset:0,customer_id:id})).status).toBe(400);
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
