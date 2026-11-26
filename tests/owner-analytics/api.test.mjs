import { describe, it, expect, vi } from 'vitest';
import { createApi } from '../../server/api.mjs';
function fixture() {
 const rpc=vi.fn(async()=>({billed_sales:0}));
 const database={withIdentity:vi.fn(async(identity,fn)=>fn({rpc})),catalog:vi.fn()};
 return {rpc,database,api:createApi({database,verifyToken:async()=>({subject:'owner',email_verified:true}),storage:{}})};
}
function req(body, authenticated=true) {return new Request('https://api.example/rpc/owner_analytics',{method:'POST',headers:{'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer test'}:{})},body:JSON.stringify(body)});}
describe('owner report HTTP boundary',()=>{
 it('rejects anonymous reads before database access',async()=>{const f=fixture();expect((await f.api.fetch(req({p_from:'2026-01-01',p_to:'2026-01-31'},false))).status).toBe(401);expect(f.database.withIdentity).not.toHaveBeenCalled();});
 it('passes only the date arguments through the identity transaction',async()=>{const f=fixture();const r=await f.api.fetch(req({p_from:'2026-01-01',p_to:'2026-01-31'}));expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');expect(f.rpc).toHaveBeenCalledWith('owner_analytics',['2026-01-01','2026-01-31']);});
 it('rejects forged authorization fields',async()=>{const f=fixture();expect((await f.api.fetch(req({p_from:'2026-01-01',p_to:'2026-01-31',is_admin:true}))).status).toBe(400);expect(f.rpc).not.toHaveBeenCalled();});
 it('does not expose database denial details',async()=>{const f=fixture();f.rpc.mockRejectedValue(Error('private-owner-data'));const r=await f.api.fetch(req({p_from:'2026-01-01',p_to:'2026-01-31'}));expect(r.status).not.toBe(200);expect(await r.text()).not.toContain('private-owner-data');});
});
