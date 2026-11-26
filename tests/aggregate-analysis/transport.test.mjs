import { describe, it, expect, vi } from 'vitest';
import { aggregateCounts, createAggregateAnalysis, COUNT_FIELDS } from '../../server/aggregate-analysis.mjs';
const counts = () => Object.fromEntries(COUNT_FIELDS.map(key => [key, 1]));
describe('aggregate-only analysis boundary', () => {
  it('defaults off without inspecting input or calling provider', async () => {
    const provider = vi.fn();
    expect(await createAggregateAnalysis({ provider })(null)).toEqual({state:'disabled'});
    expect(provider).not.toHaveBeenCalled();
  });
  it('requires explicit boolean enablement', async () => expect(await createAggregateAnalysis({enabled:'true',provider:vi.fn()})(counts())).toEqual({state:'disabled'}));
  it.each(['email','notes','unit_price_paise','from_date','tools'])('rejects additional %s', async key => {
    const provider = vi.fn();
    expect(await createAggregateAnalysis({enabled:true,provider})({...counts(),[key]:'private'})).toEqual({state:'invalid'});
    expect(provider).not.toHaveBeenCalled();
  });
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null])('rejects invalid count %s', value => expect(() => aggregateCounts({...counts(),billed_sales:value})).toThrow());
  it('rejects missing, inherited, symbol and accessor fields without invoking getters', () => {
    const missing=counts(); delete missing.billed_sales;
    expect(() => aggregateCounts(missing)).toThrow();
    expect(() => aggregateCounts(Object.create(counts()))).toThrow();
    expect(() => aggregateCounts({...counts(),[Symbol('private')]:1})).toThrow();
    const getter=vi.fn(); const input=counts(); Object.defineProperty(input,'billed_sales',{get:getter});
    expect(() => aggregateCounts(input)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('passes a detached frozen count object and bounded options only', async () => {
    const input=counts(); const provider=vi.fn(async value => { expect(Object.isFrozen(value)).toBe(true); return 'Review pending demand.'; });
    const result=await createAggregateAnalysis({enabled:true,provider})(input);
    expect(result).toEqual({state:'complete',advice:'Review pending demand.',advisory_only:true});
    expect(provider.mock.calls[0][0]).toEqual(input); expect(provider.mock.calls[0][0]).not.toBe(input);
    expect(Object.keys(provider.mock.calls[0][1]).sort()).toEqual(['maxResponseBytes','signal']);
  });
  it.each(['', 'x'.repeat(8193), 'आ'.repeat(3000), {tool_calls:[]}])('rejects invalid or oversized response', async output => {
    expect(await createAggregateAnalysis({enabled:true,provider:async()=>output})(counts())).toEqual({state:'unavailable'});
  });
  it('contains provider errors without retry or private diagnostics', async () => {
    const provider=vi.fn(async()=>{throw Error('secret');});
    expect(await createAggregateAnalysis({enabled:true,provider})(counts())).toEqual({state:'unavailable'}); expect(provider).toHaveBeenCalledTimes(1);
  });
  it('bounds waiting and prevents overlapping calls when provider ignores abort', async () => {
    let finish; let signal;
    const provider=vi.fn((_counts, options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});});
    const run=createAggregateAnalysis({enabled:true,provider,timeoutMs:5});
    expect(await run(counts())).toEqual({state:'unavailable'}); expect(signal.aborted).toBe(true);
    expect(await run(counts())).toEqual({state:'busy'}); expect(provider).toHaveBeenCalledTimes(1);
    finish('late'); await new Promise(resolve=>setTimeout(resolve,0));
  });
  it.each([0,30001,1.5])('rejects invalid timeout %s', async timeoutMs => expect(await createAggregateAnalysis({enabled:true,provider:vi.fn(),timeoutMs})(counts())).toEqual({state:'unavailable'}));
  it('accepts zero and maximum safe counts', () => { expect(aggregateCounts(Object.fromEntries(COUNT_FIELDS.map(key=>[key,0]))).billed_sales).toBe(0); expect(aggregateCounts({...counts(),billed_sales:Number.MAX_SAFE_INTEGER}).billed_sales).toBe(Number.MAX_SAFE_INTEGER); });
});
