import { describe, it, expect } from 'vitest';
import { customerText, customerTranslations } from '../../src/lib/customer-translations';

describe('customer interface translations', () => {
  it('keeps every English label and provides explicit Hindi copy', () => {
    for (const key of Object.keys(customerTranslations) as Array<keyof typeof customerTranslations>) {
      expect(customerText(key, 'en')).toBe(key);
      expect(customerText(key, 'hi')).toMatch(/[ऀ-ॿ]/);
    }
  });
  it('translates transaction actions without changing their meaning', () => {
    expect(customerText('Submit for verification', 'hi')).toBe('सत्यापन के लिए भेजें');
    expect(customerText('Accept this quotation', 'en')).toBe('Accept this quotation');
    expect(customerText('Request deletion', 'hi')).toBe('हटाने का अनुरोध करें');
  });
});
