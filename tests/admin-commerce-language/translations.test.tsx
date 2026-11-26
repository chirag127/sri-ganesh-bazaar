import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../../src/lib/use-language', () => ({ useLanguage: () => 'hi' }));
import { adminCommerceText, adminCommerceTranslations, AdminText } from '../../src/lib/admin-commerce-translations';
import { Input, Select, Panel, ActionForm, AdminContext } from '../../src/components/admin/ui';

describe('owner commerce translations', () => {
  it('preserves English and translates explicit dictionary entries', () => {
    for (const [key, value] of Object.entries(adminCommerceTranslations)) {
      expect(adminCommerceText(key, 'en')).toBe(key);
      expect(adminCommerceText(key, 'hi')).toBe(value);
      expect(value.length).toBeGreaterThan(0);
    }
  });
  it('does not alter unknown record values', () => {
    for (const value of ['Customer 123', '50 kg feed', 'private note', '123.45']) expect(adminCommerceText(value, 'hi')).toBe(value);
  });
  it('translates labels without changing input names or values', () => {
    const html = renderToStaticMarkup(<Input label="Product name" name="name" defaultValue="Original product" />);
    expect(html).toContain('उत्पाद का नाम');
    expect(html).toContain('name="name"');
    expect(html).toContain('value="Original product"');
  });
  it('preserves option payload values', () => {
    const html = renderToStaticMarkup(<Select label="Payment method" name="method"><option value="cash"><AdminText text="Cash" /></option></Select>);
    expect(html).toContain('value="cash"');
    expect(html).toContain('नकद');
  });
  it('renders translated panel and confirmation entry without invoking transactions', () => {
    const run = vi.fn();
    const html = renderToStaticMarkup(<AdminContext.Provider value={{busy:false,online:true,revision:0,run}}><Panel title="Private inventory"><ActionForm name="count_stock" label="Save physical count" prepare={() => ({payload:{},summary:'unchanged'})}><Input label="Product name" name="name" /></ActionForm></Panel></AdminContext.Provider>);
    expect(html).toContain('निजी स्टॉक');
    expect(html).toContain('वास्तविक गिनती सहेजें');
    expect(run).not.toHaveBeenCalled();
  });
});
