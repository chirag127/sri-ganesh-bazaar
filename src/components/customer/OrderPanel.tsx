import { useEffect, useRef, useState, type FormEvent } from 'react';
import { command, getCustomerOrderDetail, uploadPaymentEvidence } from '../../lib/api';
import { formatDate as formatOrderDate, money as formatOrderMoney, parseMoney } from '../../lib/format';
import { customerFlowText, customerFlowFeedback, customerFlowStatus, customerPaymentMethod, type CustomerFlowKey } from '../../lib/customer-flow-translations';
import type { OrderDetail } from '../../lib/types';
import type { ActionProps } from './CartPanel';
import { useLanguage } from '../../lib/use-language';
import { customerText, type CustomerTranslationKey } from '../../lib/customer-translations';

interface Props extends ActionProps { orderId: string; revision: number; online: boolean; onClose: () => void; }
export default function OrderPanel({ orderId, revision, online, onClose, busy, perform }: Props) {
  const locale = useLanguage();
  const t = (key: CustomerTranslationKey) => customerText(key, locale);
  const f = (key: CustomerFlowKey, values?: Record<string, string | number>) => customerFlowText(key, locale, values);
  const feedback = (message: string) => customerFlowFeedback(message, locale);
  const money = (paise: number) => feedback(formatOrderMoney(paise));
  const formatDate = (iso: string | null | undefined) => feedback(formatOrderDate(iso));
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const uploaded = useRef<{ file: File; path: string } | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setDetail(null); setError(''); setAccepted(false);
    getCustomerOrderDetail(orderId).then((value) => { if (active) setDetail(value); }).catch((failure: Error) => { if (active) setError(failure.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orderId, revision]);

  async function payment(event: FormEvent) {
    event.preventDefault();
    await perform('Submitting payment reference', async () => {
      const paise = parseMoney(amount);
      if (paise <= 0) throw new Error('Enter the amount you actually paid.');
      let path: string | undefined;
      if (screenshot) {
        if (uploaded.current?.file === screenshot) path = uploaded.current.path;
        else {
          path = await uploadPaymentEvidence(orderId, screenshot);
          uploaded.current = { file: screenshot, path };
        }
      }
      await command('submit_payment', { order_id: orderId, amount_paise: paise, reference: reference.trim(), ...(path ? { screenshot_path: path } : {}) });
      setAmount(''); setReference(''); setScreenshot(null); uploaded.current = null;
    }, 'Reference saved for bank verification. Your balance changes only after the shop confirms receipt.');
  }

  return <section className="customer-panel order-detail" aria-labelledby="detail-title">
    <button className="text-button" type="button" onClick={onClose}>{t("← Back to orders")}</button>
    {loading && <p role="status">{f('Loading current order details…')}</p>}
    {error && <p className="form-error" role="alert">{feedback(error)}</p>}
    {!loading && detail && <>
      <header className="panel-heading"><div><p className="eyebrow">{t("Order history")}</p><h2 id="detail-title">{detail.order.number}</h2><p className="muted">{f('Created {date}', { date: formatDate(detail.order.created_at) })}</p></div><span className="status-label">{customerFlowStatus(detail.order.status, locale)}</span></header>
      <dl className="detail-grid"><div><dt>{t("Receiving goods")}</dt><dd>{f(({pickup:'Shop pickup',own_driver:'Your driver collects',shop_delivery:'Shop-arranged transport'} as const)[detail.order.fulfillment])}</dd></div><div><dt>{t("Confirmed receipts")}</dt><dd>{money(detail.order.paid_paise)}</dd></div><div><dt>{t("Cash collector")}</dt><dd>{f(detail.order.cash_collector === 'driver' ? 'Assigned driver' : 'Shop')}</dd></div></dl>
      {detail.order.address && <p><strong>{t("Delivery address:")}</strong> {detail.order.address}</p>}
      {detail.order.driver_name && <p><strong>{t("Assigned driver:")}</strong> {detail.order.driver_name}{detail.order.driver_phone ? ` · ${detail.order.driver_phone}` : ''}</p>}
      {detail.order.notes && <p><strong>{t("Your note:")}</strong> {detail.order.notes}</p>}
      {detail.order.quote ? <section className="quote-card" aria-labelledby="quote-title">
        <div className="panel-heading"><h3 id="quote-title">{f('Quotation · version {version}', { version: detail.order.quote.version })}</h3><span className="muted">{f('Valid until {date}', { date: formatDate(detail.order.quote.expires_at) })}</span></div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={f('Quoted packages')}><table><thead><tr><th>{t("Package")}</th><th>{t("Bags")}</th><th>{t("Price / bag")}</th><th>{t("Total")}</th></tr></thead><tbody>{detail.order.quote.lines.map((line) => <tr key={line.variant_id}><th scope="row">{line.label}</th><td>{line.quantity}</td><td>{money(line.unit_price_paise)}</td><td>{money(line.unit_price_paise * line.quantity)}</td></tr>)}</tbody></table></div>
        <dl className="totals-list"><div><dt>{t("Goods")}</dt><dd>{money(detail.order.quote.goods_total_paise)}</dd></div><div><dt>{t("Transport payable to the shop")}</dt><dd>{money(detail.order.quote.transport_paise)}</dd></div><div className="total"><dt>{t("Total quotation")}</dt><dd>{money(detail.order.quote.total_paise)}</dd></div><div><dt>{t("Required deposit")}</dt><dd>{money(detail.order.quote.deposit_paise)}</dd></div></dl>
        {detail.order.quote.reservation_until && <p className="small">{f('If the required deposit is not confirmed by {date}, the reservation may expire.', { date: formatDate(detail.order.quote.reservation_until) })}</p>}
        {detail.order.quote.notes && <p className="notice">{detail.order.quote.notes}</p>}
        {detail.order.status === 'quoted' && <form className="stack-form" onSubmit={(event) => {
          event.preventDefault();
          if (!accepted) return;
          void perform('Accepting quotation', async () => { await command('accept_quote', { order_id: orderId, quote_id: detail.order.quote!.id }); }, 'Quotation accepted. The shop has recorded your acceptance and reserved available stock.');
        }}><label className="check-label"><input type="checkbox" required checked={accepted} onChange={(event) => setAccepted(event.currentTarget.checked)} disabled={busy || !online} /><span>{f('I approve these package quantities, prices, transport charges, and deposit terms.')}</span></label><button type="submit" className="button" disabled={!accepted || busy || !online || Date.parse(detail.order.quote.expires_at) <= Date.now()}>{t("Accept this quotation")}</button><p className="muted small">{f('The server rechecks quote validity and stock before accepting. An expired quote needs reconfirmation by the shop.')}</p></form>}
      </section> : <div className="notice"><h3>{f('The shop is preparing your quotation.')}</h3><p>{f('We will not silently substitute products or accept a price on your behalf.')}</p><ul>{detail.order.lines.map((line) => <li key={line.variant_id}>{line.label} · {f('{count} packages', { count: line.quantity })}</li>)}</ul></div>}

      {detail.order.quote && !['cancelled', 'enquiry'].includes(detail.order.status) && <details className="disclosure"><summary>{f('Already paid by UPI? Add your reference')}</summary><p>{f('Use the payment details supplied by the shop. A screenshot or reference is not proof that payment arrived.')}</p><form className="stack-form" onSubmit={payment}>
        <label>{t("Amount paid in rupees")}<input type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.currentTarget.value)} required maxLength={14} disabled={busy} placeholder="0.00" /></label>
        <label>{t("UPI transaction reference")}<input type="text" value={reference} onChange={(event) => setReference(event.currentTarget.value)} required minLength={3} maxLength={100} disabled={busy} autoComplete="off" /></label>
        <label>{t("Optional payment screenshot")}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { setScreenshot(event.currentTarget.files?.[0] ?? null); uploaded.current = null; }} /><small>{f('PNG, JPEG, or WebP; maximum 2 MiB. Stored privately, not in the offline catalog.')}</small></label>
        <button type="submit" className="button" disabled={busy || !online}>{t("Submit for verification")}</button>
      </form></details>}
      {detail.payment_submissions.length > 0 && <section><h3>{t("Payment references")}</h3><ul className="record-list">{detail.payment_submissions.map((item) => <li key={item.id}><span><strong>{money(item.amount_paise)}</strong><br /><span className="muted">{item.reference} · {formatDate(item.created_at)}</span></span><span className="status-label">{customerFlowStatus(item.status, locale)}</span></li>)}</ul></section>}
      {detail.receipts.length > 0 && <section className="sales-document"><h3>{t("Receipts")}</h3><ul className="record-list">{detail.receipts.map((receipt) => <li key={receipt.id}><div><strong>{receipt.number}</strong><p>{customerFlowStatus(receipt.kind, locale)} · {customerPaymentMethod(receipt.method, locale)} · {formatDate(receipt.issued_at)}</p><small>{f(receipt.received_by === 'driver' ? 'Received by assigned driver; remittance tracked separately.' : 'Received / paid by the shop.')}</small></div><strong>{money(receipt.amount_paise)}</strong></li>)}</ul></section>}
      {detail.bills.map((bill) => <section key={bill.id} className="sales-document"><p className="eyebrow">{f('Pashu Saathi')}</p><h3>{f('Sales bill {number}', { number: bill.number })}</h3><p>{f('Issued {date} · Order {number}', { date: formatDate(bill.issued_at), number: detail.order.number })}</p><div className="table-scroll"><table><thead><tr><th>{t("Package")}</th><th>{t("Quantity")}</th><th>{t("Unit price")}</th><th>{t("Amount")}</th></tr></thead><tbody>{bill.lines.map((line) => <tr key={line.variant_id}><th scope="row">{line.label}</th><td>{line.quantity}</td><td>{money(line.unit_price_paise)}</td><td>{money(line.quantity * line.unit_price_paise)}</td></tr>)}</tbody></table></div><p>{f('Transport: {amount}', { amount: money(bill.transport_paise) })}</p><p><strong>{f('Bill total: {amount}', { amount: money(bill.total_paise) })}</strong></p><p className="small muted">{f('Sales bill, not a GST tax invoice. Receipts and later adjustments are recorded separately.')}</p></section>)}
      {(detail.bills.length > 0 || detail.receipts.length > 0) && <button type="button" className="button secondary" onClick={() => window.print()}>{t("Print order documents")}</button>}
      {(detail.returns?.length ?? 0) > 0 && <section><h3>{t("Approved return adjustments")}</h3><ul className="record-list">{detail.returns!.map((item) => <li key={item.id}><span>{item.note}<br /><small>{formatDate(item.created_at)}</small></span><strong>{money(item.amount_paise)}</strong></li>)}</ul><p className="small muted">{f('A return adjustment and an actual cash/UPI refund are separate records.')}</p></section>}
      {['enquiry', 'quoted', 'accepted', 'ready'].includes(detail.order.status) && <details className="disclosure"><summary>{t("Request cancellation")}</summary><form className="stack-form" onSubmit={(event) => { event.preventDefault(); if (!window.confirm(f('Cancel this order? Recorded payments will remain in your history.'))) return; void perform('Cancelling order', async () => { await command('cancel_order', { order_id: orderId, reason: reason.trim() }); }, 'Cancellation recorded. Any payment/refund history remains available.'); }}><label>{t("Reason")}<textarea value={reason} onChange={(event) => setReason(event.currentTarget.value)} required maxLength={500} rows={2} disabled={busy} /></label><button type="submit" className="button danger" disabled={busy || !online}>{t("Cancel order")}</button></form></details>}
    </>}
  </section>;
}
