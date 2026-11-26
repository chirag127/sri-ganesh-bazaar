import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountTranslations, accountText, accountFeedback, accountStatus } from '../../src/lib/account-translations';
import type { Workspace } from '../../src/lib/types';
const locale = vi.hoisted(() => ({ value: 'en' as 'en' | 'hi' }));
vi.mock('../../src/lib/use-language', () => ({ useLanguage: () => locale.value }));
vi.mock('../../src/lib/api', () => ({ command: vi.fn(), getCommercePage: vi.fn() }));
vi.mock('../../src/lib/auth', () => ({ confirmSms: vi.fn(), requestSms: vi.fn(), requestPush: vi.fn() }));
import AccountPanel, { normalizeIndianPhone } from '../../src/components/customer/AccountPanel';
const workspace: Workspace = {
  customer: { id: 'customer', auth_user_id: 'user', name: 'Customer original नाम', phone: '+919876543210', phone_status: 'staff_confirmed', email: 'buyer@example.test', address: 'Original address पता', created_at: '2026-01-01T00:00:00Z' },
  orders: [], bills: [], is_admin: false, balance_paise: 12345,
  ledger: [{ id: 'entry', customer_id: 'customer', order_id: null, kind: 'payment', amount_paise: -12345, note: 'Original payment note संदेश', created_at: '2026-01-01T00:00:00Z' }],
  deletion_requests: [{ id: 'deletion', customer_id: 'customer', reason: null, status: 'rejected', note: 'Original staff response उत्तर', created_at: '2026-01-01T00:00:00Z' }],
};
function render(patch: Partial<Workspace> = {}) {
  return renderToStaticMarkup(createElement(AccountPanel, { workspace: { ...workspace, ...patch }, online: true, busy: false, perform: async () => {} }));
}
afterEach(() => { locale.value = 'en'; vi.unstubAllEnvs(); });
describe('complete account static copy', () => {
  it('provides Hindi for every account dictionary entry and preserves English', () => {
    for (const key of Object.keys(accountTranslations) as Array<keyof typeof accountTranslations>) {
      expect(accountText(key, 'en')).toBe(key);
      expect(accountText(key, 'hi')).toMatch(/[ऀ-ॿ]/);
    }
    expect(accountFeedback('Customer arbitrary original text', 'hi')).toBe('Customer arbitrary original text');
  });
  it.each(['en', 'hi'] as const)('preserves private record text, amounts and links in %s', language => {
    locale.value = language;
    const html = render();
    for (const original of ['Customer original नाम', 'buyer@example.test', 'Original address पता', 'Original payment note संदेश', 'Original staff response उत्तर', '+919876543210', '123.45']) expect(html).toContain(original);
    expect(html).toContain(`lang="${language}"`);
    expect(html).toContain('href="/account-deletion/"');
    expect(html).toContain(accountText('This is a shop ledger, not a transferable payment wallet. Deposits can be allocated to orders. Pending UPI references do not count as confirmed receipts. An account credit is not automatically a refundable cash balance.', language));
    expect(html).toContain(accountText('Phone verification security check', language));
  });
  it.each([12345, -12345, 0])('translates the balance state %s', balance_paise => {
    locale.value = 'hi';
    const key = balance_paise > 0 ? 'Net amount due to the shop' : balance_paise < 0 ? 'Net advance / credit recorded with the shop' : 'Your recorded account is balanced';
    expect(render({ balance_paise })).toContain(accountText(key, 'hi'));
  });
  it('translates empty ledger and deletion consent without changing form constraints', () => {
    locale.value = 'hi';
    const html = render({ ledger: [], deletion_requests: [] });
    expect(html).toContain(accountText('No financial entries have been posted.', 'hi'));
    expect(html).toContain(accountText('I want the shop to process an account deletion request.', 'hi'));
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('type="checkbox"');
  });
  it.each(['false', 'true'])('translates unverified phone guidance with SMS=%s', flag => {
    vi.stubEnv('PUBLIC_ENABLE_SMS', flag);
    locale.value = 'hi';
    const html = render({ customer: { ...workspace.customer, phone_status: 'unverified' } });
    const key = flag === 'true' ? "Save your number first. SMS verification is subject to the shop's daily allowance and provider availability; staff can confirm your contact if it is unavailable." : 'SMS is not enabled. The shop can confirm your number by a manual call or in person.';
    expect(html).toContain(accountText(key, 'hi'));
  });
  it('keeps phone normalization compatible and localizes its known validation error', () => {
    expect(normalizeIndianPhone('98765 43210')).toBe('+919876543210');
    expect(normalizeIndianPhone('+91 (98765) 43210')).toBe('+919876543210');
    const message = 'Enter a valid 10-digit Indian mobile number, optionally beginning with +91.';
    expect(() => normalizeIndianPhone('123')).toThrow(message);
    expect(accountFeedback(message, 'hi')).toBe(accountTranslations[message]);
    expect(accountFeedback('Saving contact details', 'hi')).toBe(accountTranslations['Saving contact details']);
  });
  it('translates known account states but leaves unknown values to the existing formatter', () => {
    for (const value of ['unverified','sms_verified','staff_confirmed','requested','processing','completed','rejected','sale','payment','refund','return','opening_balance']) expect(accountStatus(value, 'hi', x => x)).toMatch(/[ऀ-ॿ]/);
    expect(accountStatus('unknown', 'hi', x => `formatted ${x}`)).toBe('formatted unknown');
    expect(accountStatus('payment', 'en', x => `formatted ${x}`)).toBe('formatted payment');
  });
});
