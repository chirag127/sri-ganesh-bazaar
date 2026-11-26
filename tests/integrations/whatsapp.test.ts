import { describe, it, expect } from 'vitest';
import { whatsappLink } from '../../src/lib/whatsapp';
describe('WhatsApp click-to-chat', () => {
  it('requires explicit enablement', () => {
    for (const flag of [undefined, false, true, 'false', '']) expect(whatsappLink(flag, '919876543210')).toBeNull();
  });
  it('uses only a validated international number without private query data', () => {
    expect(whatsappLink('true', '919876543210')).toBe('https://wa.me/919876543210');
  });
  it.each(['', '+919876543210', '0912345678', '123', '1234567890123456', '919876543210?text=private', 'javascript:alert(1)', '91 9876543210'])('rejects malformed number %s', number => {
    expect(whatsappLink('true', number)).toBeNull();
  });
});
