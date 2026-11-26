import type { CartLine } from './types';

export const CART_KEY = 'sgb.public-cart.v1';
export const CART_EVENT = 'sgb:cart-updated';
export const MAX_CART_LINES = 50;
export const MAX_PACKAGE_QUANTITY = 10_000;
let memoryCart: CartLine[] = [];
let hasUnsavedMemory = false;

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}

export function sanitizeCart(input: unknown): CartLine[] {
  if (!Array.isArray(input)) return [];
  const quantities = new Map<string, number>();
  for (const entry of input.slice(0, MAX_CART_LINES * 2)) {
    if (!entry || typeof entry !== 'object' || !validId(entry.variant_id)
      || !Number.isSafeInteger(entry.quantity) || entry.quantity < 1
      || entry.quantity > MAX_PACKAGE_QUANTITY) continue;
    const total = (quantities.get(entry.variant_id) ?? 0) + entry.quantity;
    if (total <= MAX_PACKAGE_QUANTITY && (quantities.has(entry.variant_id) || quantities.size < MAX_CART_LINES)) {
      quantities.set(entry.variant_id, total);
    }
  }
  return Array.from(quantities, ([variant_id, quantity]) => ({ variant_id, quantity }));
}

export function loadCart(): CartLine[] {
  if (typeof window === 'undefined') return [];
  if (!hasUnsavedMemory) {
    try {
      const stored = window.localStorage.getItem(CART_KEY);
      memoryCart = stored === null ? [] : sanitizeCart(JSON.parse(stored));
    } catch { /* A blocked storage accessor must not prevent shopping in this tab. */ }
  }
  return memoryCart.map((line) => ({ ...line }));
}

export function saveCart(lines: CartLine[]): void {
  memoryCart = sanitizeCart(lines);
  if (typeof window === 'undefined') return;
  hasUnsavedMemory = true;
  try {
    window.localStorage.setItem(CART_KEY, JSON.stringify(memoryCart));
    hasUnsavedMemory = false;
  } catch { /* Keep the newer in-memory cart rather than rereading an older stored version. */ }
  window.dispatchEvent(new Event(CART_EVENT));
}

export function addToCart(variantId: string, quantity = 1): CartLine[] {
  if (!validId(variantId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_PACKAGE_QUANTITY) {
    throw new Error('Choose a valid package and a whole quantity.');
  }
  const lines = loadCart();
  const existing = lines.find((line) => line.variant_id === variantId);
  if (existing) {
    if (existing.quantity + quantity > MAX_PACKAGE_QUANTITY) throw new Error('This package exceeds the cart quantity limit.');
    existing.quantity += quantity;
  } else {
    if (lines.length >= MAX_CART_LINES) throw new Error('The cart can hold up to 50 package choices.');
    lines.push({ variant_id: variantId, quantity });
  }
  saveCart(lines);
  return lines;
}

export function updateCartQuantity(variantId: string, quantity: number): CartLine[] {
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > MAX_PACKAGE_QUANTITY) {
    throw new Error('Enter a whole package quantity between 0 and 10,000.');
  }
  const lines = loadCart().flatMap((line) => line.variant_id !== variantId
    ? [line] : quantity === 0 ? [] : [{ variant_id: variantId, quantity }]);
  saveCart(lines);
  return lines;
}
