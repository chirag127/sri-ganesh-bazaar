import { useEffect, useRef, useState, type FormEvent } from 'react';
import { command, request } from '../../lib/api';
import { money, parseQuantity } from '../../lib/format';
import { createEstimateGuard, parseCartEstimate, type CartEstimate } from '../../lib/cart-estimate';
import { saveCart, updateCartQuantity } from '../../lib/cart';
import { useLanguage } from '../../lib/use-language';
import { customerText, type CustomerTranslationKey } from '../../lib/customer-translations';
import { customerFlowText, customerFlowFeedback, type CustomerFlowKey } from '../../lib/customer-flow-translations';
import type { CartLine, CatalogSnapshot, Fulfillment, Workspace } from '../../lib/types';

export interface ActionProps {
  busy: boolean;
  perform: (label: string, task: () => Promise<void>, success?: string) => Promise<void>;
}
interface Props extends ActionProps {
  cart: CartLine[];
  catalog: CatalogSnapshot | null;
  workspace: Workspace | null;
  online: boolean;
  signedIn: boolean;
  onSignIn: () => void;
  onProfile: () => void;
}

export default function CartPanel({ cart, catalog, workspace, online, signedIn, onSignIn, onProfile, busy, perform }: Props) {
  const locale = useLanguage();
  const t = (key: CustomerTranslationKey) => customerText(key, locale);
  const f = (key: CustomerFlowKey, values?: Record<string, string | number>) => customerFlowText(key, locale, values);
  const feedback = (message: string) => customerFlowFeedback(message, locale);
  const [fulfillment, setFulfillment] = useState<Fulfillment>('pickup');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [localError, setLocalError] = useState('');
  const guard = useRef(createEstimateGuard());
  const approved = signedIn && (workspace?.customer as { estimate_approved?: boolean } | undefined)?.estimate_approved === true;
  const estimateKey = JSON.stringify([workspace?.customer.id, approved, online, fulfillment, address, cart, catalog?.configured]);
  const latestKey = useRef(estimateKey);
  latestKey.current = estimateKey;
  const [estimateState, setEstimateState] = useState<{key: string; value?: CartEstimate; loading?: boolean; error?: string} | null>(null);
  const estimate = estimateState?.key === estimateKey ? estimateState : null;
  useEffect(() => {
    guard.current.invalidate();
    setEstimateState(null);
    return () => { guard.current.invalidate(); };
  }, [estimateKey]);

  async function estimateCart() {
    if (!approved || !online || !catalog?.configured || !cart.length || busy) return;
    const key = estimateKey;
    const token = guard.current.begin();
    setEstimateState({key, loading: true});
    try {
      const value = parseCartEstimate(await request('/rpc/cart_estimate', {
        p_lines: cart.map(({variant_id, quantity}) => ({variant_id, quantity})), p_fulfillment: fulfillment,
      }));
      if (guard.current.current(token) && latestKey.current === key) setEstimateState({key, value});
    } catch {
      if (guard.current.current(token) && latestKey.current === key) setEstimateState({key, error: 'Estimate unavailable. Your approval or stock may have changed. Refresh your account or send an enquiry for a quotation.'});
    }
  }
  const choices = new Map(catalog?.products.flatMap((product) => product.variants.map((variant) => [variant.id, { product, variant }] as const)) ?? []);
  const missing = cart.some((line) => !choices.has(line.variant_id));
  const canSubmit = signedIn && Boolean(workspace?.customer.phone) && Boolean(catalog?.configured) && online && cart.length > 0 && !missing;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || !confirmed) return;
    setLocalError('');
    await perform('Sending enquiry', async () => {
      const result = await command('submit_enquiry', {
        lines: cart,
        fulfillment,
        address: fulfillment === 'shop_delivery' ? address.trim() : null,
        notes: notes.trim(),
      });
      saveCart([]);
      setConfirmed(false);
      if (result.id) window.location.hash = 'orders';
    }, 'Enquiry saved. The shop will check the bags and send a quotation before you commit.');
  }

  return <section aria-labelledby="cart-title" className="customer-panel">
    <header className="panel-heading"><div><p className="eyebrow">{t("Start with an enquiry")}</p><h2 id="cart-title">{t("Your bag list")}</h2></div><span className="count-label">{f(cart.length === 1 ? '{count} package choice' : '{count} package choices', { count: cart.length })}</span></header>
    <p className="muted">{f('Your goods price, transport charge, and any deposit will appear together in your private quotation.')}</p>
    {catalog?.stale && <p className="notice warning" role="status">{f('Showing a saved catalog. Availability and prices must be reconfirmed by the shop.')}</p>}
    {!catalog?.configured && <p className="notice">{f('This is a setup preview. Illustrative products cannot be ordered.')}</p>}
    {cart.length === 0 ? <div className="empty-state"><h3>{f('A good order starts with the right bags.')}</h3><p>{f('Explore the catalog and add the packages you need. No payment is required to build your list.')}</p><a className="button" href="/products/">{t("Browse products")}</a></div> : <>
      <ul className="cart-lines">
        {cart.map((line) => {
          const choice = choices.get(line.variant_id);
          return <li key={line.variant_id}>
            <div className="cart-line-copy"><h3>{choice?.product.name ?? f('Package no longer in the catalog')}</h3><p>{choice?.variant.label ?? f('Remove this package before sending an enquiry.')}</p>{choice && !choice.variant.available && <p className="status-label">{f('Currently unavailable — the shop must reconfirm.')}</p>}</div>
            <div className="quantity-control"><label htmlFor={`qty-${line.variant_id}`}>{t("Bags / packages")}</label><input id={`qty-${line.variant_id}`} type="number" min="1" max="10000" step="1" value={line.quantity} disabled={busy} onChange={(event) => {
              try { updateCartQuantity(line.variant_id, parseQuantity(event.currentTarget.value)); setLocalError(''); } catch (error) { setLocalError((error as Error).message); }
            }} /><button type="button" className="text-button" disabled={busy} onClick={() => updateCartQuantity(line.variant_id, 0)}>{t("Remove")}</button></div>
          </li>;
        })}
      </ul>
      {localError && <p role="alert" className="form-error">{feedback(localError)}</p>}
      <div className="notice" aria-label={f('Private cart estimate')}>
        {approved ? <>
          <p>{f('Approximate totals are available for your approved account. An estimate does not reserve stock; the final quotation still requires your acceptance.')}</p>
          <button type="button" disabled={busy || !online || !catalog?.configured || missing || estimate?.loading} onClick={() => void estimateCart()}>{t(estimate?.loading ? 'Calculating estimate…' : 'Calculate approximate total')}</button>
          {!online && <p>{f('Reconnect to request a fresh estimate. Private estimates are not saved offline.')}</p>}
          <div role="status" aria-live="polite">
            {estimate?.error && <p>{feedback(estimate.error)}</p>}
            {estimate?.value && <>
              <p>{f('Approximate goods total:')} <strong>{feedback(money(estimate.value.goods_total_paise))}</strong></p>
              {estimate.value.total_min_paise === null ? <p>{f('Delivery charges are not configured. The shop will confirm delivery and the final total in your quotation.')}</p> : <>
                <p>{f('Delivery estimate: {min} – {max}', { min: feedback(money(estimate.value.delivery_min_paise!)), max: feedback(money(estimate.value.delivery_max_paise!)) })}</p>
                <p>{f('Approximate total:')} <strong>{feedback(money(estimate.value.total_min_paise))} – {feedback(money(estimate.value.total_max_paise!))}</strong></p>
              </>}
            </>}
          </div>
        </> : <p>{f('Prices stay private. Shop-approved customers can request approximate totals; all customers receive their prices in a private quotation.')}</p>}
      </div>
      <p className="muted small">{f('Transport is quoted separately. This is not an accepted order or a sales bill.')}</p>
      {!signedIn ? <div className="notice"><p>{f('Use your Google account to keep enquiries, quotations, and receipts together.')}</p><button type="button" className="button" onClick={onSignIn} disabled={busy || !online || !catalog?.configured}>{t("Continue with Google")}</button></div> : !workspace?.customer.phone ? <div className="notice"><p>{f('Add a contact phone number before sending your first enquiry.')}</p><button type="button" className="button" onClick={onProfile}>{t("Complete contact details")}</button></div> : null}
      <form onSubmit={submit} className="stack-form">
        <fieldset disabled={busy}><legend>{t("How will you receive the goods?")}</legend><div className="choice-grid">
          {([
            ['pickup', 'Collect from the shop', 'Come to the shop after your order is confirmed.'],
            ['own_driver', 'Send your own driver', 'You arrange transport; tell the shop who will collect.'],
            ['shop_delivery', 'Shop-arranged transport', 'The shop quotes a tempo or e-rickshaw separately.'],
          ] as const).map(([value, label, detail]) => <label className="choice-card" key={value}><input type="radio" name="fulfillment" value={value} checked={fulfillment === value} onChange={() => setFulfillment(value)} /><span><strong>{f(label)}</strong><small>{f(detail)}</small></span></label>)}
        </div></fieldset>
        {fulfillment === 'shop_delivery' && <label>{f('Delivery address and Indian pincode')}<textarea value={address} onChange={(event) => setAddress(event.currentTarget.value)} required maxLength={1000} rows={3} disabled={busy} placeholder={f('Address, landmark, town, and pincode')} /><small>{f('Serviceability is confirmed in your quotation. No courier is booked automatically.')}</small></label>}
        <label>{f('Custom instructions / विशेष निर्देश')} <span className="muted">{f('Optional / वैकल्पिक')}</span><textarea value={notes} onChange={(event) => setNotes(event.currentTarget.value)} maxLength={1000} rows={4} disabled={busy} placeholder={f('Write in Hindi or English — जैसे: गेहूँ का चोकर चाहिए, शाम को सामान लेंगे। / Prefer wheat bran; pickup in the evening.')} /><small>{f('Hindi, English, or Roman Hindi are welcome. Specify product quality, bag size, or collection requirements. Do not include passwords or payment credentials. Instructions are saved with your enquiry for the shop to review; changes require confirmation in your quote.')}</small></label>
        <label className="check-label"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.currentTarget.checked)} required disabled={busy} /><span>{f('I understand this is an enquiry. I will review and approve the final quotation before the order is accepted.')}</span></label>
        <button className="button" type="submit" disabled={!canSubmit || busy || !confirmed}>{t("Send enquiry")}</button>
        {!online && <p className="notice warning">{f('Your bag list is saved on this device where storage is available. Reconnect to submit; nothing has been sent.')}</p>}
      </form>
    </>}
  </section>;
}
