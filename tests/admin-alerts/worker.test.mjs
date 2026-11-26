import { describe, it, expect, vi } from 'vitest';
import { createAdminAlertWorker, createAdminAlertDatabase, WORKER_ROLE_CHECK } from '../../server/admin-alert-worker.mjs';
const job={id:'id',lease_id:'lease',event:'low_stock'};
function fixture(outcome){const database={claim:vi.fn(async()=>job),finish:vi.fn(async()=>true)};const transport={send:vi.fn(async()=>outcome)};return {database,transport,run:createAdminAlertWorker({database,transport,enabled:true})};}
describe('admin alert worker',()=>{
 it('disabled worker never claims',async()=>{const database={claim:vi.fn()};expect(await createAdminAlertWorker({database})()).toEqual({state:'disabled'});expect(database.claim).not.toHaveBeenCalled();});
 it('idle worker never sends',async()=>{const f=fixture({});f.database.claim.mockResolvedValue(null);expect(await f.run()).toEqual({state:'idle'});expect(f.transport.send).not.toHaveBeenCalled();});
 it.each([{state:'sent',provider_id:'12'},{state:'uncertain'},{state:'failed'}])('finishes a single outcome %j',async outcome=>{const f=fixture(outcome);expect(await f.run()).toEqual({state:outcome.state});expect(f.transport.send).toHaveBeenCalledExactlyOnceWith('low_stock');expect(f.database.finish).toHaveBeenCalledWith(job,outcome);});
 it('transport exception is uncertain',async()=>{const f=fixture({});f.transport.send.mockRejectedValue(Error('secret'));expect(await f.run()).toEqual({state:'uncertain'});});
 it('only bounded explicit rate limits are retried',async()=>{const f=fixture({state:'failed',reason:'rate_limited',retry_after:10});await f.run();expect(f.database.finish).toHaveBeenCalledWith(job,{state:'rate_limited',retry_after:10});});
 it.each([0,-1,86401,1.5,undefined])('rejects invalid retry %s',async retry_after=>{const f=fixture({reason:'rate_limited',retry_after});expect(await f.run()).toEqual({state:'failed'});});
 it('ambiguous finish does not resend',async()=>{const f=fixture({state:'sent',provider_id:'1'});f.database.finish.mockRejectedValue(Error('commit unknown'));await expect(f.run()).rejects.toThrow();expect(f.transport.send).toHaveBeenCalledTimes(1);});
 it('rejects unsafe worker connection before claim',async()=>{const query=vi.fn(async()=>({rows:[{safe:false}]}));const release=vi.fn();await expect(createAdminAlertDatabase({connect:async()=>({query,release})}).claim()).rejects.toThrow('Unsafe');expect(query).toHaveBeenLastCalledWith('ROLLBACK');expect(release).toHaveBeenCalled();});
 it('role policy requires worker and excludes runtime',()=>{expect(WORKER_ROLE_CHECK).toContain("pg_has_role(session_user, 'commerce_worker', 'MEMBER')");expect(WORKER_ROLE_CHECK).toContain("rolname = 'commerce_runtime'");expect(WORKER_ROLE_CHECK).toContain('owners JOIN reachable');});
});
