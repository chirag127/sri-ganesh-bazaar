const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const dates = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
});

export function money(paise: number): string {
  if (!Number.isSafeInteger(paise)) return 'Amount unavailable';
  return currency.format(paise / 100);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Not set';
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? 'Date unavailable' : dates.format(value);
}

export function parseMoney(text: string): number {
  const value = text.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) {
    throw new Error('Enter a non-negative rupee amount with at most two decimal places.');
  }
  const [rupees, decimals = ''] = value.split('.');
  const paise = Number(rupees) * 100 + Number(decimals.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise)) throw new Error('That amount is too large.');
  return paise;
}

export function parseQuantity(text: string): number {
  const value = text.trim();
  if (!/^[1-9]\d*$/.test(value)) throw new Error('Enter a whole number of packages greater than zero.');
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity > 10_000) {
    throw new Error('Enter between 1 and 10,000 packages.');
  }
  return quantity;
}

export function labelStatus(status: string): string {
  return status.replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}
