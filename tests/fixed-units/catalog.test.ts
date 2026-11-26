import { describe, it, expect } from 'vitest';
import { sampleCatalog, validatePublicSnapshot } from '../../src/data/catalog';
function snapshot() {
  const product = structuredClone(sampleCatalog[0]);
  product.variants = [{ ...product.variants[0], weight_kg: null, unit_kind: 'jar' }];
  return { configured: true, products: [product] };
}
describe('fixed-unit public catalog', () => {
  it('accepts null physical weight and preserves selling kind without prices', () => {
    const input = snapshot();
    Object.assign(input.products[0].variants[0], { reference_price_paise: 12345 });
    const result = validatePublicSnapshot(input);
    expect(result.products[0].variants[0]).toMatchObject({ weight_kg: null, unit_kind: 'jar' });
    expect(JSON.stringify(result)).not.toContain('reference_price');
  });
  it('defaults legacy weighted variants to bag', () => {
    const input = snapshot();
    delete input.products[0].variants[0].unit_kind;
    input.products[0].variants[0].weight_kg = 50;
    expect(validatePublicSnapshot(input).products[0].variants[0].unit_kind).toBe('bag');
  });
  it('rejects invalid units and physical weights', () => {
    for (const patch of [{ unit_kind: 'loose' }, { weight_kg: -1 }, { weight_kg: 0 }, { weight_kg: 10001 }]) {
      const input = snapshot();
      Object.assign(input.products[0].variants[0], patch);
      expect(() => validatePublicSnapshot(input)).toThrow();
    }
  });
});
