import { parseMoney } from '../../lib/format';
import type { Order, OrderStatus, AdminProduct as Product, QuoteLine } from '../../lib/types';

export const PAGE_SIZE = 25;
export const PACKAGE_LIMIT = 10_000;
export interface DraftLine { key: number; variant_id: string; quantity: string; price: string }
export interface PricedLine { variant_id: string; quantity: number; unit_price_paise: number }

export function text(data: FormData, name: string, required = false): string {
  const value = String(data.get(name) ?? '').trim();
  if (required && !value) throw new Error(`Enter ${name.replaceAll('_', ' ')}.`);
  return value;
}
export function checked(data: FormData, name: string): boolean { return data.get(name) === 'on'; }
export function requireCheck(data: FormData, name: string, message: string): void {
  if (!checked(data, name)) throw new Error(message);
}
export function integer(value: string, label = 'Package quantity', allowZero = false): number {
  if (!/^\d+$/.test(value.trim())) throw new Error(`${label} must be a whole number.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1) || number > PACKAGE_LIMIT) {
    throw new Error(`${label} must be between ${allowZero ? 0 : 1} and ${PACKAGE_LIMIT.toLocaleString('en-IN')}.`);
  }
  return number;
}
export function stockDelta(value: string): number {
  if (!/^-?[1-9]\d*$/.test(value.trim())) throw new Error('Stock adjustment must be a nonzero whole number of packages.');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || Math.abs(result) > PACKAGE_LIMIT) throw new Error('Adjust at most 10,000 packages per recorded movement.');
  return result;
}
export function rupees(paise: number): string {
  if (!Number.isSafeInteger(paise)) return '';
  return (paise / 100).toFixed(2);
}
export function amount(data: FormData, name: string, positive = false): number {
  const result = parseMoney(text(data, name, true));
  if (positive && result <= 0) throw new Error('Enter an amount greater than zero.');
  return result;
}
export function safeSum(values: number[]): number {
  const total = values.reduce((sum, value) => {
    if (!Number.isSafeInteger(value)) throw new Error('An amount exceeds the supported range.');
    const next = sum + value;
    if (!Number.isSafeInteger(next)) throw new Error('The total exceeds the supported range.');
    return next;
  }, 0);
  return total;
}
export function priceLines(lines: DraftLine[]): PricedLine[] {
  if (!lines.length || lines.length > 100) throw new Error('Choose between 1 and 100 package lines.');
  const ids = new Set<string>();
  return lines.map((line) => {
    if (!line.variant_id) throw new Error('Choose a package for every line.');
    if (ids.has(line.variant_id)) throw new Error('Each package can appear only once. Combine its quantities.');
    ids.add(line.variant_id);
    const quantity = integer(line.quantity);
    const unit_price_paise = parseMoney(line.price);
    if (unit_price_paise <= 0) throw new Error('Every package price must be greater than zero.');
    safeSum([quantity * unit_price_paise]);
    return { variant_id: line.variant_id, quantity, unit_price_paise };
  });
}
export function goodsTotal(lines: PricedLine[]): number {
  return safeSum(lines.map((line) => line.quantity * line.unit_price_paise));
}
export function draftLines(lines: Array<{ variant_id: string; quantity: number; unit_price_paise?: number }>, products: Product[]): DraftLine[] {
  const variants = products.flatMap((product) => product.variants);
  return lines.map((line, key) => ({ key, variant_id: line.variant_id, quantity: String(line.quantity),
    price: rupees(line.unit_price_paise ?? variants.find((variant) => variant.id === line.variant_id)?.reference_price_paise ?? 0) }));
}
export function localDateTime(iso: string | number): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function futureDate(value: string, now = Date.now()): string {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime()) || date.getTime() <= now) throw new Error('Choose a reservation deadline in the future.');
  return date.toISOString();
}
export function nextStatuses(order: Pick<Order, 'status' | 'fulfillment'>): OrderStatus[] {
  if (order.status === 'accepted') return ['ready'];
  if (order.status === 'ready') return [order.fulfillment === 'shop_delivery' ? 'dispatched' : 'completed'];
  if (order.status === 'dispatched') return ['completed'];
  return [];
}
export function outstanding(order: Order): number | null {
  if (!order.quote || !Number.isSafeInteger(order.quote.total_paise) || !Number.isSafeInteger(order.paid_paise)) return null;
  return Math.max(0, order.quote.total_paise - order.paid_paise);
}
export function handoverPayload(order: Order, data: FormData): Record<string, unknown> {
  const status = text(data, 'status', true) as OrderStatus;
  if (!nextStatuses(order).includes(status)) throw new Error('This transition is no longer available. Refresh the order.');
  const handover_note = text(data, 'handover_note', true);
  let cod_approved = false;
  if (order.status === 'ready') {
    const due = outstanding(order);
    if (due === null) throw new Error('A current quote is required before goods can leave the shop.');
    const mode = text(data, 'handover_mode', true);
    if (!['paid', 'credit', 'cod'].includes(mode)) throw new Error('Choose how the outstanding amount is handled.');
    if (mode === 'paid' && due > 0) throw new Error('This order is not fully paid. Record an actual receipt or use approved credit/COD.');
    if (mode === 'credit' && !order.quote?.credit_approved) throw new Error('Credit must be approved in this sale’s quote before handover.');
    if (mode === 'cod') {
      if (order.fulfillment === 'pickup' || order.cash_collector !== 'driver' || !order.driver_name?.trim() || !order.driver_phone?.trim()) {
        throw new Error('COD requires an assigned named driver, phone number, and driver cash collection.');
      }
      requireCheck(data, 'cod_confirmed', 'Confirm that COD is outstanding collectible money, not a payment.');
      cod_approved = true;
    }
  }
  return { order_id: order.id, status, handover_note, cod_approved };
}
export function paymentPayload(data: FormData, customerId: string, orderId?: string, submissionId?: string): Record<string, unknown> {
  if (!customerId) throw new Error('Select a customer first.');
  const method = text(data, 'method', true);
  if (method !== 'cash' && method !== 'upi') throw new Error('Choose cash or UPI.');
  const received_by = text(data, 'received_by', true);
  if (received_by !== 'shop' && received_by !== 'driver') throw new Error('Choose who actually received the money.');
  if (received_by === 'driver' && !orderId) throw new Error('A driver collection must be attached to an assigned order.');
  const payload: Record<string, unknown> = { customer_id: customerId, amount_paise: amount(data, 'amount', true),
    method, received_by, note: text(data, 'note', true) };
  if (orderId) payload.order_id = orderId;
  if (submissionId) payload.payment_submission_id = submissionId;
  const reference = text(data, 'reference');
  if (reference) payload.reference = reference;
  requireCheck(data, 'actual_receipt', 'Confirm actual receipt of the money. A screenshot alone is not confirmation.');
  if (method === 'upi') {
    if (!reference) throw new Error('Enter the bank’s UPI transaction reference.');
    requireCheck(data, 'bank_verified', 'Verify the UPI credit in the receiving bank account first.');
    payload.bank_verified = true;
    payload.verification_note = text(data, 'verification_note', true);
  }
  return payload;
}
export function returnLines(data: FormData, sold: QuoteLine[]): Array<{ variant_id: string; quantity: number; restock: boolean }> {
  const selected = sold.flatMap((line) => {
    const quantity = integer(text(data, `return_${line.variant_id}`) || '0', 'Returned packages', true);
    if (quantity > line.quantity) throw new Error('A return cannot exceed the original sold package quantity.');
    return quantity ? [{ variant_id: line.variant_id, quantity, restock: checked(data, `restock_${line.variant_id}`) }] : [];
  });
  if (!selected.length) throw new Error('Enter at least one returned package.');
  return selected;
}
export function readableError(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed. Refresh the records before retrying a financial change.';
}
