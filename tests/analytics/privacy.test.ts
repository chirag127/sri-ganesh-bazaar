import { describe, it, expect } from 'vitest';
import { analyticsConfig, publicAnalyticsRoute, readConsent, saveConsent, pageView } from '../../src/lib/public-analytics';

describe('public analytics privacy boundary', () => {
  it('defaults to no providers', () => expect(analyticsConfig({})).toEqual({ga4:null,clarity:null}));
  it('requires explicit flags and valid identifiers', () => {
    expect(analyticsConfig({PUBLIC_ENABLE_ANALYTICS:'true',PUBLIC_GA4_MEASUREMENT_ID:'G-ABC123',PUBLIC_ENABLE_CLARITY:'true',PUBLIC_CLARITY_PROJECT_ID:'abc123'})).toEqual({ga4:'G-ABC123',clarity:'abc123'});
    expect(analyticsConfig({PUBLIC_ENABLE_ANALYTICS:true,PUBLIC_GA4_MEASUREMENT_ID:'G-ABC123'}).ga4).toBeNull();
    expect(analyticsConfig({PUBLIC_ENABLE_ANALYTICS:'true',PUBLIC_GA4_MEASUREMENT_ID:'G-ABC123&secret=x',PUBLIC_ENABLE_CLARITY:'true',PUBLIC_CLARITY_PROJECT_ID:'../secret'})).toEqual({ga4:null,clarity:null});
  });
  it.each(['/','/products/','/products/wheat-bran/','/categories/','/categories/cattle-feed/'])('allows public route %s', path => expect(publicAnalyticsRoute(new URL(path,'https://shop.test'))).toBe(true));
  it.each(['/app/','/admin/','/auth/','/account/','/contact/','/products/?q=private','/#private','/?analytics=off','/products/index.html'])('excludes private or ambiguous route %s', path => expect(publicAnalyticsRoute(new URL(path,'https://shop.test'))).toBe(false));
  it('fails closed for unreadable consent storage', () => expect(readConsent({getItem(){throw Error();}})).toBe(false));
  it('accepts only affirmative consent', () => {
    for (const value of [null,'no','true','']) expect(readConsent({getItem:()=>value})).toBe(false);
    expect(readConsent({getItem:()=> 'yes'})).toBe(true);
  });
  it('reports persistence failure', () => expect(saveConsent({setItem(){throw Error();}},true)).toBe(false));
  it('writes explicit revocation', () => {
    let stored=''; expect(saveConsent({setItem(_key,value){stored=value;}},false)).toBe(true); expect(stored).toBe('no');
  });
  it('never includes query, fragment or referrer in a page view', () => {
    const event=pageView(new URL('https://shop.test/products/?email=private#secret'));
    expect(event.page_location).toBe('https://shop.test/products/');
    expect(event.page_referrer).toBe(''); expect(JSON.stringify(event)).not.toMatch(/email|secret|private/);
  });
});
