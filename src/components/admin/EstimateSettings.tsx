import { createContext, useContext, useRef, useState } from 'react';
import { parseMoney } from '../../lib/format';
import { Input, useAdmin } from './ui';
import { useLanguage } from '../../lib/use-language';
import { adminSettingsText } from '../../lib/admin-settings-translations';

export type EstimateAction = 'set_estimate_approval' | 'set_delivery_range';
export type EstimateRunner = (action: EstimateAction, payload: Record<string, unknown>) => Promise<void>;
export const EstimateSettingsContext = createContext<EstimateRunner | null>(null);

/** Retain IDs after ambiguous failures; a changed payload is a new operation. */
export function createSettingsAttempt(id: () => string = () => crypto.randomUUID()) {
  const attempts = new Map<string, string>();
  const keyFor = (action: EstimateAction, payload: Record<string, unknown>) => JSON.stringify([action, Object.keys(payload).sort().map(k => [k, payload[k]])]);
  const begin = (action: EstimateAction, payload: Record<string, unknown>) => {
    const key = keyFor(action, payload);
    if (!attempts.has(key)) attempts.set(key, id());
    return { ...payload, request_id: attempts.get(key)! };
  };
  return Object.assign(begin, { complete: (action: EstimateAction, payload: Record<string, unknown>) => { attempts.delete(keyFor(action, payload)); } });
}
export function deliveryPayload(min: string, max: string) {
  const min_paise = parseMoney(min), max_paise = parseMoney(max);
  if (max_paise < min_paise) throw new Error('Maximum delivery charge must not be below the minimum.');
  return { min_paise, max_paise };
}
function useSettingsMutation() {
  const run = useContext(EstimateSettingsContext);
  const { busy, online } = useAdmin();
  const attempt = useRef(createSettingsAttempt());
  const lock = useRef(false);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const send = async (action: EstimateAction, payload: Record<string, unknown>) => {
    if (!run || busy || !online || lock.current) return;
    lock.current = true; setPending(true); setError('');
    try {
      await run(action, attempt.current(action, payload));
      attempt.current.complete(action, payload);
    }
    catch { setError('Change was not confirmed. Refresh records before retrying. Retrying this change uses the same request ID.'); }
    finally { lock.current = false; setPending(false); }
  };
  return { send, disabled: !run || busy || !online || pending, pending, error, setError };
}
export function EstimateApproval({ customerId, approved }: { customerId: string; approved: boolean }) {
  const locale = useLanguage();
  const t = (text: string) => adminSettingsText(text, locale);
  const mutation = useSettingsMutation();
  return <section aria-label={t('Customer estimate permission')}><h3>{t('Private cart estimates')}</h3><p>{t('Current access:')} {t(approved ? 'Approved' : 'Not approved')}. {t('This permission does not grant staff access or approve credit.')}</p><button type="button" disabled={mutation.disabled} onClick={() => void mutation.send('set_estimate_approval', { customer_id: customerId, approved: !approved })}>{t(mutation.pending ? 'Saving permission…' : approved ? 'Revoke estimate access' : 'Approve estimate access')}</button>{mutation.error && <p role="alert">{t(mutation.error)}</p>}</section>;
}
export default function EstimateSettings() {
  const locale = useLanguage();
  const t = (text: string) => adminSettingsText(text, locale);
  const mutation = useSettingsMutation();
  const [min, setMin] = useState(''), [max, setMax] = useState('');
  return <section className="admin-panel"><h2>{t('Delivery estimate range')}</h2><p>{t('Set the approximate transport range shown to approved customers. Final transport charges are confirmed in each quote. Blank fields do not represent the saved range.')}</p><form onSubmit={event => { event.preventDefault(); if (mutation.disabled) return; try { void mutation.send('set_delivery_range', deliveryPayload(min, max)); } catch (error) { mutation.setError(error instanceof Error ? error.message : 'Check the amounts.'); } }}><fieldset disabled={mutation.disabled}><Input label={t('Minimum delivery charge (₹)')} required value={min} onChange={e => setMin(e.target.value)} inputMode="decimal"/><Input label={t('Maximum delivery charge (₹)')} required value={max} onChange={e => setMax(e.target.value)} inputMode="decimal"/></fieldset><button disabled={mutation.disabled} type="submit">{t(mutation.pending ? 'Saving range…' : 'Save delivery range')}</button>{mutation.error && <p role="alert">{t(mutation.error)}</p>}</form></section>;
}
