import { AdminText } from '../../lib/admin-commerce-translations';
import { useState } from 'react';
import { getPaymentEvidenceUrl } from '../../lib/api';
import { formatDate, money } from '../../lib/format';
import type { Bill, PaymentSubmission, Receipt } from '../../lib/types';
import { paymentPayload, readableError, rupees } from './model';
import { ActionForm, Check, ErrorNotice, Input, Select, TextArea } from './ui';

export function PaymentForm({ customerId, orderId, submission }: { customerId: string; orderId?: string; submission?: PaymentSubmission }) {
  const [method, setMethod] = useState(submission ? 'upi' : 'cash');
  return <ActionForm name="record_payment" label="Record receipt" prepare={(data) => ({ payload: paymentPayload(data, customerId, orderId, submission?.id), summary: <p>Record actual {method.toUpperCase()} receipt of ₹{String(data.get('amount'))}. This credits the customer once.</p> })}>
    <Input label="Amount received (₹)" name="amount" required inputMode="decimal" defaultValue={submission ? rupees(submission.amount_paise) : ''} />
    <Select label="Payment method" name="method" value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash"><AdminText text="Cash"/ ></option><option value="upi"><AdminText text="UPI"/ ></option></Select>
    <Select label="Actually received by" name="received_by"><option value="shop"><AdminText text="Shop"/ ></option>{orderId && <option value="driver"><AdminText text="Assigned driver — pending remittance"/ ></option>}</Select>
    <Input label="Transaction reference" name="reference" required={method === 'upi'} defaultValue={submission?.reference} />
    {method === 'upi' && <><TextArea label="Bank verification evidence" name="verification_note" required hint="Record the receiving bank credit checked, not just the customer's screenshot." /><Check name="bank_verified" required><AdminText text="I verified the credit in the receiving bank account."/ ></Check></>}
    <TextArea label="Receipt / collection note" name="note" required /><Check name="actual_receipt" required><AdminText text="I confirm the money was actually received. A screenshot alone is not proof."/ ></Check>
  </ActionForm>;
}
export function Evidence({ submission }: { submission: PaymentSubmission }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [url, setUrl] = useState('');
  return <div><p>{money(submission.amount_paise)} · {submission.reference} · {submission.status}</p><p>{formatDate(submission.created_at)}</p>{submission.screenshot_path && <button type="button" className="admin-button admin-secondary" disabled={busy} onClick={async () => { setBusy(true); setError(''); setUrl(''); try { setUrl(await getPaymentEvidenceUrl(submission.screenshot_path!)); } catch (e) { setError(readableError(e)); } finally { setBusy(false); } }}><AdminText text="Prepare private screenshot link"/ ></button>}{url && <p><a href={url} target="_blank" rel="noreferrer"><AdminText text="Download private evidence (expires in 60 seconds)"/ ></a></p>}<ErrorNotice error={error} /></div>;
}
export function Documents({ bills = [], receipts = [] }: { bills?: Bill[]; receipts?: Receipt[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  return <div><p className="admin-muted"><AdminText text="Print only on a trusted device. These are sales bills and receipts, not GST invoices."/ ></p>{bills.map((bill) => <article className={`admin-document ${selected === bill.id ? 'admin-print-selected' : ''}`} key={bill.id}><h3>Sales bill {bill.number}</h3><p>{formatDate(bill.issued_at)} · Order {bill.order_id}</p><ul>{bill.lines.map((line) => <li key={line.variant_id}>{line.label} — {line.quantity} packages × {money(line.unit_price_paise)}</li>)}</ul><p>Transport: {money(bill.transport_paise)}</p><strong>Total: {money(bill.total_paise)}</strong><button type="button" className="admin-button admin-secondary" onClick={() => { setSelected(bill.id); requestAnimationFrame(() => window.print()); }}><AdminText text="Print this bill"/ ></button></article>)}{receipts.map((receipt) => <article key={receipt.id} className={`admin-document ${selected === receipt.id ? 'admin-print-selected' : ''}`}><h3>{receipt.kind === 'refund' ? 'Refund receipt' : 'Payment receipt'} {receipt.number}</h3><p>{formatDate(receipt.issued_at)} · {receipt.method.toUpperCase()}</p><p>{receipt.reference || 'Cash receipt'} · Received by {receipt.received_by}</p><strong>{money(receipt.amount_paise)}</strong><p>{receipt.note}</p><button className="admin-button admin-secondary" type="button" onClick={() => { setSelected(receipt.id); requestAnimationFrame(() => window.print()); }}><AdminText text="Print this receipt"/ ></button></article>)}</div>;
}
