/** Click-to-chat only: no credentials, automatic messages, or order confirmation. */
export function whatsappLink(enabled: unknown, number: unknown): string | null {
  if (enabled !== 'true' || typeof number !== 'string') return null;
  const digits = number.trim();
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return null;
  return `https://wa.me/${digits}`;
}
