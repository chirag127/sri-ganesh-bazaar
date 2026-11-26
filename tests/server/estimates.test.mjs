import { describe, it, expect, vi } from 'vitest';
import { createApi } from '../../server/api.mjs';
const id='00000000-0000-4000-8000-000000000001';
function fixture(){const rpc=vi.fn(async()=>({approximate:true,goods_total_paise:100})); const database={withIdentity:vi.fn(async(i,fn)=>fn({rpc})),catalog:vi.fn()}; return {rpc,database,api:createApi({database,verifyToken:async()=>({subject:'buyer',email_verified:true}),storage:{}})};}
function request(name,body,auth=true){return new Request('https://api.example/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer valid'}:{})},body:JSON.stringify(body)});}
describe('private estimate transport',()=>{
 it('rejects anonymous estimates before database access',async()=>{const f=fixture();expect((await f.api.fetch(request('cart_estimate',{p_lines:[],p_fulfillment:'pickup'},false))).status).toBe(401);expect(f.database.withIdentity).not.toHaveBeenCalled();});
 it('passes only fixed arguments through trusted identity transaction',async()=>{const f=fixture();const lines=[{variant_id:id,quantity:2}];const r=await f.api.fetch(request('cart_estimate',{p_lines:lines,p_fulfillment:'pickup'}));expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');expect(f.rpc).toHaveBeenCalledWith('cart_estimate',[lines,'pickup']);});
 it('rejects forged identity arguments',async()=>{const f=fixture();expect((await f.api.fetch(request('cart_estimate',{p_lines:[],p_fulfillment:'pickup',customer_id:id}))).status).toBe(400);expect(f.rpc).not.toHaveBeenCalled();});
 it('requires settings command idempotency IDs',async()=>{const f=fixture();expect((await f.api.fetch(request('estimate_settings_command',{p_action:'set_delivery_range',p_payload:{}}))).status).toBe(400);expect(f.rpc).not.toHaveBeenCalled();});
 it('dispatches valid settings commands to database authorization',async()=>{const f=fixture();const payload={request_id:id,min_paise:100,max_paise:200};expect((await f.api.fetch(request('estimate_settings_command',{p_action:'set_delivery_range',p_payload:payload}))).status).toBe(200);expect(f.rpc).toHaveBeenCalledWith('estimate_settings_command',['set_delivery_range',payload]);});
 it('does not disclose denied estimate or database details',async()=>{const f=fixture();f.rpc.mockRejectedValue(new Error('private price 123456'));const r=await f.api.fetch(request('cart_estimate',{p_lines:[],p_fulfillment:'pickup'}));expect(r.status).not.toBe(200);expect(await r.text()).not.toContain('123456');});
});
