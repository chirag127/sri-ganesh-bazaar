import { describe, it, expect, vi } from 'vitest';
vi.mock('../../src/components/admin/ui', () => ({Input: () => null, useAdmin: () => ({busy:false, online:true})}));
import { createSettingsAttempt, deliveryPayload } from '../../src/components/admin/EstimateSettings';

describe('owner estimate settings', () => {
  it('retains the request identity after an ambiguous failure', () => {
    let n=0; const attempt=createSettingsAttempt(()=>`request-${++n}`);
    const payload={customer_id:'customer',approved:true};
    expect(attempt('set_estimate_approval',payload).request_id).toBe(attempt('set_estimate_approval',{approved:true,customer_id:'customer'}).request_id);
    expect(n).toBe(1);
  });
  it('uses new IDs for different mutations and for a confirmed repeat', () => {
    let n=0; const attempt=createSettingsAttempt(()=>`request-${++n}`);
    const payload={customer_id:'customer',approved:true};
    const first=attempt('set_estimate_approval',payload);
    expect(attempt('set_estimate_approval',{...payload,approved:false}).request_id).not.toBe(first.request_id);
    attempt.complete('set_estimate_approval',payload);
    expect(attempt('set_estimate_approval',payload).request_id).not.toBe(first.request_id);
    expect(payload).not.toHaveProperty('request_id');
  });
  it('converts rupees to integer paise and permits a zero range', () => {
    expect(deliveryPayload('10.25','20')).toEqual({min_paise:1025,max_paise:2000});
    expect(deliveryPayload('0','0')).toEqual({min_paise:0,max_paise:0});
  });
  it.each([['20','10'],['','10'],['-1','10'],['1.001','10'],['0','9007199254740991']])('rejects invalid delivery range %s / %s',(min,max)=>{
    expect(()=>deliveryPayload(min,max)).toThrow();
  });
});
