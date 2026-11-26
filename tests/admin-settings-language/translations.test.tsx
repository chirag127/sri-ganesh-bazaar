import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { adminSettingsTranslations, adminSettingsText } from '../../src/lib/admin-settings-translations';
const locale = vi.hoisted(() => ({ value: 'en' as 'en' | 'hi' }));
vi.mock('../../src/lib/use-language', () => ({ useLanguage: () => locale.value }));
import OwnerAnalytics from '../../src/components/admin/OwnerAnalytics';
import EstimateSettings, { EstimateApproval, EstimateSettingsContext, deliveryPayload, createSettingsAttempt } from '../../src/components/admin/EstimateSettings';
import { AdminContext } from '../../src/components/admin/ui';
function settings(child: ReturnType<typeof createElement>) {
  return renderToStaticMarkup(createElement(AdminContext.Provider, { value: { busy:false, online:true, revision:0, run:async()=>({}) } }, createElement(EstimateSettingsContext.Provider, { value:async()=>{} }, child)));
}
describe('admin settings language', () => {
  it('has explicit Hindi translations and preserves English and unknown record text', () => {
    for (const [en, hi] of Object.entries(adminSettingsTranslations)) {
      expect(adminSettingsText(en, 'en')).toBe(en);
      expect(adminSettingsText(en, 'hi')).toBe(hi);
      expect(hi).toMatch(/[ऀ-ॿ]/);
    }
    expect(adminSettingsText('Customer supplied text 123', 'hi')).toBe('Customer supplied text 123');
  });
  it('renders owner report labels and offline guidance in Hindi', () => {
    locale.value='hi';
    const html=renderToStaticMarkup(createElement(OwnerAnalytics, {subject:'owner',online:false}));
    expect(html).toContain(adminSettingsTranslations['Private shop counts']);
    expect(html).toContain(adminSettingsTranslations['Reconnect to load a report. Reports are not stored offline.']);
    expect(html).toContain('disabled');
  });
  it('renders delivery and approval controls in either language', () => {
    for (const language of ['en','hi'] as const) {
      locale.value=language;
      expect(settings(createElement(EstimateSettings))).toContain(adminSettingsText('Save delivery range',language));
      expect(settings(createElement(EstimateApproval,{customerId:'original-id',approved:true}))).toContain(adminSettingsText('Revoke estimate access',language));
      expect(settings(createElement(EstimateApproval,{customerId:'original-id',approved:false}))).toContain(adminSettingsText('Approve estimate access',language));
    }
  });
  it('preserves paise conversion, range validation and idempotency payloads', () => {
    expect(deliveryPayload('10.25','20')).toEqual({min_paise:1025,max_paise:2000});
    expect(()=>deliveryPayload('20','10')).toThrow('Maximum delivery');
    const attempt=createSettingsAttempt(()=> 'same-id');
    const payload={customer_id:'original-id',approved:true};
    expect(attempt('set_estimate_approval',payload)).toEqual({...payload,request_id:'same-id'});
    expect(attempt('set_estimate_approval',payload).request_id).toBe('same-id');
  });
});
