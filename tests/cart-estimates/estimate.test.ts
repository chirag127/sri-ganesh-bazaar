import { describe, it, expect } from 'vitest';
import { parseCartEstimate, createEstimateGuard } from '../../src/lib/cart-estimate';
const valid = { goods_total_paise: 10000, delivery_min_paise: 1000, delivery_max_paise: 2000, total_min_paise: 11000, total_max_paise: 12000, approximate: true, reserves_stock: false };
describe('private cart estimate validation', () => {
  it('retains only aggregate totals', () => {
    expect(parseCartEstimate({...valid, unit_price_paise: 5000, email: 'private'})).toEqual(valid);
  });
  it('accepts unconfigured delivery without inventing a total', () => {
    const input = {...valid, delivery_min_paise:null, delivery_max_paise:null, total_min_paise:null, total_max_paise:null};
    expect(parseCartEstimate(input)).toEqual(input);
  });
  it('accepts zero delivery for collection', () => {
    expect(parseCartEstimate({...valid, delivery_min_paise:0, delivery_max_paise:0, total_min_paise:10000, total_max_paise:10000}).total_min_paise).toBe(10000);
  });
  for (const patch of [{approximate:false}, {reserves_stock:true}, {goods_total_paise:-1}, {goods_total_paise:1.1}, {goods_total_paise:Infinity}, {delivery_min_paise:null}, {delivery_min_paise:3000}, {total_min_paise:1}, {total_max_paise:1}, {goods_total_paise:Number.MAX_SAFE_INTEGER}]) {
    it(`rejects inconsistent response ${JSON.stringify(patch)}`, () => expect(()=>parseCartEstimate({...valid,...patch})).toThrow('invalid estimate'));
  }
  it('rejects absent response', () => expect(()=>parseCartEstimate(null)).toThrow());
  it('invalidates late and superseded requests', () => {
    const guard = createEstimateGuard();
    const first=guard.begin(); const second=guard.begin();
    expect(guard.current(first)).toBe(false); expect(guard.current(second)).toBe(true);
    guard.invalidate(); expect(guard.current(second)).toBe(false);
  });
});
