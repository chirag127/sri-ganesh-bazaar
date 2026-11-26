import { describe, it, expect, vi } from 'vitest';
import { sampleCatalog, validatePublicSnapshot, loadBuildCatalog, getSiteOrigin, publicImageUrl, staticPageHref, jsonForHtml } from '../../src/data/catalog';

describe('public storefront boundary', () => {
  it('labels the proposed assortment unavailable and normalizes fixed units without prices', async () => {
    const snapshot = await loadBuildCatalog({});
    expect(snapshot.configured).toBe(false);
    expect(snapshot.products).toHaveLength(20);
    const normalized = validatePublicSnapshot({ configured: true, products: snapshot.products });
    expect(normalized.products).toEqual(snapshot.products.map(product => ({
      ...product, variants: product.variants.map(variant => ({ ...variant, unit_kind: variant.unit_kind ?? 'bag' })),
    })));
    expect(validatePublicSnapshot(normalized)).toEqual(normalized);
    expect(JSON.stringify(normalized)).not.toContain('reference_price_paise');
    for (const product of snapshot.products) {
      expect(product.description).toMatch(/illustrative/i);
      expect(product.name).toMatch(/[ऀ-ॿ]/);
      for (const variant of product.variants) {
        expect(variant.label).toBe(`${variant.weight_kg} kg bag`);
        expect(variant.weight_kg).toBeGreaterThan(0);
      }
    }
    for (const product of snapshot.products) for (const variant of product.variants) {
      expect(variant.available).toBe(false);
      expect(variant).not.toHaveProperty('reference_price_paise');
    }
  });
  it('includes distinct feed products and searchable local aliases without guessing uncertain terms', () => {
    const slugs = sampleCatalog.map(product => product.slug);
    expect(slugs).toEqual(expect.arrayContaining([
      'wheat-bran', 'chickpea-husk', 'chickpea-churi', 'broken-chickpea',
      'barley', 'barley-meal', 'whole-wheat', 'maize-bag', 'pearl-millet',
      'rice-bran', 'de-oiled-rice-bran', 'mustard-oil-cake', 'cottonseed-cake',
      'soybean-meal', 'groundnut-cake', 'cattle-feed', 'feed-grade-salt', 'feed-mineral-mixture',
    ]));
    const searchable = sampleCatalog.map(product => `${product.name} ${product.description}`).join(' ').toLowerCase();
    for (const alias of ['choker', 'chane ka chilka', 'chane ki chouri', 'chane ka khanda', 'jaw ka atta', 'gay hun', 'bajra']) {
      expect(searchable).toContain(alias);
    }
    expect(searchable).not.toMatch(/binone ki khal|sarasutu ki khal/);
    expect(sampleCatalog.find(product => product.id === 'example-cattle-feed')?.variants.map(variant => variant.id))
      .toEqual(['example-feed-25', 'example-feed-50']);
    for (const id of ['wheat', 'rice', 'millet', 'maize', 'salt']) {
      expect(sampleCatalog.find(product => product.id === `example-${id}`)?.variants.map(variant => variant.id))
        .toEqual([`example-${id}-25`, `example-${id}-50`]);
    }
    for (const product of sampleCatalog.slice(6)) {
      expect(JSON.stringify(product.variants)).not.toContain('reference_price_paise');
    }
  });
  it('accepts 50 distinct products and rejects 51', () => {
    const products = Array.from({ length: 51 }, (_, index) => ({
      ...sampleCatalog[0], id: `limit-${index}`, slug: `limit-${index}`,
      variants: [{ ...sampleCatalog[0].variants[0], id: `variant-${index}`, product_id: `limit-${index}` }],
    }));
    expect(validatePublicSnapshot({ configured: true, products: products.slice(0, 50) }).products).toHaveLength(50);
    expect(() => validatePublicSnapshot({ configured: true, products })).toThrow('invalid');
  });
  it('reconstructs only public fields from a snapshot', () => {
    const products = structuredClone(sampleCatalog).map(p => ({ ...p, purchase_cost: 123, customer_phone: 'PRIVATE', variants: p.variants.map(v => ({ ...v, on_hand: 321, average_cost_paise: 456, reference_price_paise: 999999 })) }));
    const result = JSON.stringify(validatePublicSnapshot({ configured: true, products, secret: 'PRIVATE' }));
    expect(result).not.toMatch(/PRIVATE|purchase_cost|on_hand|average_cost|reference_price_paise|999999/);
  });
  it('rejects invalid amounts and duplicate slugs', () => {
    const products = structuredClone(sampleCatalog);
    products[0].variants[0].weight_kg = -1;
    expect(() => validatePublicSnapshot({ configured: true, products })).toThrow();
    expect(() => validatePublicSnapshot({ configured: true, products: [sampleCatalog[0], sampleCatalog[0]] })).toThrow();
  });
  it('fails configured builds instead of substituting examples', async () => {
    const env = { PUBLIC_COMMERCE_API_URL: 'https://api.example' };
    await expect(loadBuildCatalog({ PUBLIC_COMMERCE_API_URL: 'postgres://secret@db.example/shop' })).rejects.toThrow();
    await expect(loadBuildCatalog(env, vi.fn().mockRejectedValue(new Error('offline')))).rejects.toThrow('no sample');
    await expect(loadBuildCatalog(env, vi.fn().mockResolvedValue(new Response('', {status: 503})))).rejects.toThrow('request failed');
    await expect(loadBuildCatalog(env, vi.fn().mockResolvedValue(new Response('not JSON')))).rejects.toThrow('invalid');
  });
  it('fetches the public Neon API without credentials and strips private fields', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ configured: true, products: sampleCatalog, secret: 'PRIVATE' }));
    const result = await loadBuildCatalog({ PUBLIC_COMMERCE_API_URL: 'https://api.example' }, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith('https://api.example/catalog', expect.objectContaining({method:'GET',credentials:'omit',cache:'no-store',redirect:'error'}));
    expect(result.configured).toBe(true);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('rejects private and signed image URLs', () => {
    expect(publicImageUrl('https://api.example/evidence/file.png?token=secret', 'https://api.example')).toBeNull();
    expect(publicImageUrl('https://api.example/assets/private.png', 'https://api.example')).toBeNull();
    expect(publicImageUrl('https://api.example/images/bag.png', 'https://api.example')).toBe('https://api.example/images/bag.png');
    expect(publicImageUrl('/images/bag.svg')).toBe('/images/bag.svg');
  });
  it('keeps stable HTTPS canonicals and native file paths', () => {
    expect(getSiteOrigin('https://shop.example')).toBe('https://shop.example');
    expect(() => getSiteOrigin('http://shop.example')).toThrow();
    expect(staticPageHref('/app/#cart')).toBe('/app/index.html#cart');
    expect(staticPageHref('/products/wheat/?q=bag')).toBe('/products/wheat/index.html?q=bag');
    expect(staticPageHref('https://elsewhere.example/')).toBe('https://elsewhere.example/');
    expect(jsonForHtml('</script>')).not.toContain('<');
  });
});
