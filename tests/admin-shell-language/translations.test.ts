import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { adminShellText, adminShellTranslations } from '../../src/lib/admin-shell-translations';
const locale = vi.hoisted(() => ({ value: 'en' }));
vi.mock('../../src/lib/use-language', () => ({ useLanguage: () => locale.value }));
import AdminApp from '../../src/components/AdminApp';

describe('owner shell language', () => {
  it('keeps English copy and supplies explicit Hindi for every shell key', () => {
    for (const [key, hindi] of Object.entries(adminShellTranslations)) {
      expect(adminShellText(key, 'en')).toBe(key);
      expect(adminShellText(key, 'hi')).toBe(hindi);
      expect(hindi).toMatch(/[ऀ-ॿ]/);
    }
  });
  it('does not translate unknown data or mutate it', () => {
    for (const value of ['Customer private note', '12345', 'दूध की मांग', '<script>']) {
      expect(adminShellText(value, 'hi')).toBe(value);
    }
  });
  it.each(['en', 'hi'])('renders the unauthenticated shell in %s without granting staff access', value => {
    locale.value = value;
    const html = renderToStaticMarkup(createElement(AdminApp));
    expect(html).toContain(adminShellText('Authorized staff only', value as 'en' | 'hi'));
    expect(html).toContain(adminShellText('Continue with Google', value as 'en' | 'hi'));
    expect(html).toContain(adminShellText('The shop, in order.', value as 'en' | 'hi'));
    expect(html).not.toContain('class="admin-nav"');
    expect(html).toContain('href="/app/"');
    expect(html).toContain('href="/products/"');
  });
});
