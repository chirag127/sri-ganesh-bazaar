import { describe, expect, it, vi } from 'vitest';
import { parseMoney, parseQuantity, money, formatDate } from '../../src/lib/format';
import { sanitizeCart } from '../../src/lib/cart';
import { createCommandQueue } from '../../src/lib/commands';
import { evidenceFormat, EVIDENCE_PATH, MAX_EVIDENCE_BYTES } from '../../src/lib/evidence';

describe('money and package quantities', () => {
  it('converts decimal currency to integer paise', () => {
    expect(parseMoney('19.99')).toBe(1999);
    expect(parseMoney(' 1000 ')).toBe(100000);
    expect(parseMoney('0.01')).toBe(1);
  });
  it.each(['-1', '1.001', '1e4', 'NaN', '', '01', '1,000', '99999999999999999'])('rejects invalid amount %s', (value) => expect(() => parseMoney(value)).toThrow());
  it.each(['0', '-1', '2.5', '1e3', '10001'])('rejects invalid bags %s', (value) => expect(() => parseQuantity(value)).toThrow());
  it('formats unavailable values truthfully', () => {
    expect(money(NaN)).toBe('Amount unavailable');
    expect(formatDate('invalid')).toBe('Date unavailable');
    expect(parseQuantity('25')).toBe(25);
  });
});

describe('public-only cart', () => {
  it('drops unknown properties and rejects fractions and malformed IDs', () => {
    expect(sanitizeCart([{ variant_id: 'sample-bag', quantity: 2, phone: 'private' }, { variant_id: 'fraction', quantity: 1.5 }, { variant_id: '<script>', quantity: 1 }])).toEqual([{ variant_id: 'sample-bag', quantity: 2 }]);
  });
  it('merges duplicate package rows and bounds total quantities', () => {
    expect(sanitizeCart([{ variant_id: 'a', quantity: 3 }, { variant_id: 'a', quantity: 2 }])).toEqual([{ variant_id: 'a', quantity: 5 }]);
    expect(sanitizeCart([{ variant_id: 'a', quantity: 10000 }, { variant_id: 'a', quantity: 1 }])).toEqual([{ variant_id: 'a', quantity: 10000 }]);
    expect(sanitizeCart(null)).toEqual([]);
  });
});

describe('command idempotency', () => {
  it('reuses a request identifier after an ambiguous transport error', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue({ id: 'order' });
    const queue = createCommandQueue(transport, () => 'request-a');
    await expect(queue.run('user', 'submit_enquiry', { lines: [{ variant_id: 'a', quantity: 1 }] })).rejects.toThrow('network');
    await expect(queue.run('user', 'submit_enquiry', { lines: [{ variant_id: 'a', quantity: 1 }] })).resolves.toEqual({ id: 'order' });
    expect(transport.mock.calls[0][1].request_id).toBe(transport.mock.calls[1][1].request_id);
  });
  it('coalesces simultaneous identical requests but permits a later intentional action', async () => {
    let finish!: (value: { id: string }) => void;
    const transport = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ id: 'next' });
    const uuid = vi.fn().mockReturnValueOnce('first').mockReturnValueOnce('second');
    const queue = createCommandQueue(transport, uuid);
    const first = queue.run('u', 'record_payment', { amount_paise: 100 });
    const doubleClick = queue.run('u', 'record_payment', { amount_paise: 100 });
    await Promise.resolve();
    expect(transport).toHaveBeenCalledTimes(1);
    finish({ id: 'saved' });
    await Promise.all([first, doubleClick]);
    await queue.run('u', 'record_payment', { amount_paise: 100 });
    expect(transport.mock.calls[1][1].request_id).toBe('second');
  });
  it('canonicalizes object order, scopes retries to the account, and rejects caller IDs', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('retry'));
    let counter = 0;
    const queue = createCommandQueue(transport, () => String(++counter));
    await queue.run('a', 'save_profile', { name: 'Example', phone: '1' }).catch(() => {});
    await queue.run('a', 'save_profile', { phone: '1', name: 'Example' }).catch(() => {});
    await queue.run('b', 'save_profile', { phone: '1', name: 'Example' }).catch(() => {});
    expect(transport.mock.calls.map((call) => call[1].request_id)).toEqual(['1', '1', '2']);
    await expect(queue.run('a', 'save_profile', { request_id: 'forged' })).rejects.toThrow('managed');
  });
});

describe('private evidence validation', () => {
  it('accepts supported signatures, rejects active/unknown content and oversized bytes', () => {
    expect(evidenceFormat(new Uint8Array([137,80,78,71,13,10,26,10])).extension).toBe('png');
    expect(evidenceFormat(new Uint8Array([255,216,255])).mime).toBe('image/jpeg');
    expect(() => evidenceFormat(new TextEncoder().encode('<svg onload="bad()"/>'))).toThrow('PNG');
    expect(() => evidenceFormat(new Uint8Array(MAX_EVIDENCE_BYTES + 1))).toThrow('2 MiB');
  });
  it('accepts only namespaced evidence object keys', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(EVIDENCE_PATH.test(`${id}/${id}/${id}.webp`)).toBe(true);
    expect(EVIDENCE_PATH.test(`../${id}.png`)).toBe(false);
    expect(EVIDENCE_PATH.test(`${id}/${id}/${id}.html`)).toBe(false);
  });
});
