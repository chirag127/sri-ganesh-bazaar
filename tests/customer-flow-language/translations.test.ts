import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { customerFlowTranslations, customerFlowText, customerFlowFeedback, customerFlowStatuses, customerFlowStatus, customerPaymentMethod } from '../../src/lib/customer-flow-translations';
import type { CustomerFlowKey } from '../../src/lib/customer-flow-translations';
import { customerText } from '../../src/lib/customer-translations';
import { money } from '../../src/lib/format';
import CartPanel from '../../src/components/customer/CartPanel';

const language = vi.hoisted(() => ({ value: 'hi' as 'en' | 'hi' }));
vi.mock('../../src/lib/use-language', () => ({ useLanguage: () => language.value }));
vi.mock('../../src/lib/api', () => ({ command: vi.fn(), request: vi.fn() }));

describe('explicit customer transaction translations', () => {
  it('has Hindi copy and matching interpolation placeholders for every key', () => {
    for (const [key, hindi] of Object.entries(customerFlowTranslations)) {
      expect(hindi).toMatch(/[ऀ-ॿ]/);
      expect(customerFlowText(key as CustomerFlowKey, 'en')).toBe(key);
      expect(customerFlowText(key as CustomerFlowKey, 'hi')).toBe(hindi);
      expect(hindi.match(/\{\w+\}/g)?.sort() ?? []).toEqual(key.match(/\{\w+\}/g)?.sort() ?? []);
    }
  });
  it('preserves interpolated numbers and arbitrary content without recursive replacement', () => {
    expect(customerFlowText('{start}–{end} of {total}', 'hi', { start: 21, end: 40, total: 65 })).toBe('कुल 65 में से 21–40');
    expect(customerFlowText('Sales bill {number}', 'hi', { number: 'TEST-${date}-चोकर' })).toBe('बिक्री बिल TEST-${date}-चोकर');
    expect(customerFlowText('Transport: {amount}', 'hi', { amount: money(12345) })).toBe(`परिवहन: ${money(12345)}`);
  });
  it('translates stored feedback on each render and preserves unknown errors', () => {
    for (const message of ['Sending enquiry', 'Submitting payment reference', 'Cancelling order', 'Enter the amount you actually paid.']) {
      expect(customerFlowFeedback(message, 'hi')).not.toBe(message);
      expect(customerFlowFeedback(message, 'en')).toBe(message);
    }
    expect(customerFlowFeedback('The shop request failed (503). Check history before retrying.', 'hi')).toContain('(503)');
    for (const message of ['Unknown server detail: test', '__proto__', 'Customer supplied note']) expect(customerFlowFeedback(message, 'hi')).toBe(message);
  });
  it('translates all known statuses and cash without changing protocol values', () => {
    for (const [value, hindi] of Object.entries(customerFlowStatuses)) expect(customerFlowStatus(value, 'hi')).toBe(hindi);
    expect(customerFlowStatus('new_status', 'hi')).toBe('New status');
    expect(customerPaymentMethod('cash', 'hi')).toBe('नकद');
    expect(customerPaymentMethod('cash', 'en')).toBe('CASH');
    expect(customerPaymentMethod('upi', 'hi')).toBe('UPI');
  });
  it('renders Hindi cart safety copy while preserving product names and quantities', () => {
    const props = { cart: [{ variant_id: 'fixture', quantity: 7 }], catalog: { configured: true, products: [{ id: 'p', slug: 'fixture', name: 'Shop', category: 'fixture', description: '', image_url: null, active: true, variants: [{ id: 'fixture', product_id: 'p', label: 'Sending enquiry', available: true, weight_kg: null }] }] }, workspace: null, online: false, signedIn: false, busy: false, perform: vi.fn(), onSignIn: vi.fn(), onProfile: vi.fn() };
    language.value = 'hi';
    const hindi = renderToStaticMarkup(createElement(CartPanel, props));
    expect(hindi).toContain('<h3>Shop</h3>');
    expect(hindi).toContain('<p>Sending enquiry</p>');
    expect(hindi).toContain('value="7"');
    expect(hindi).toContain(customerFlowTranslations['Your bag list is saved on this device where storage is available. Reconnect to submit; nothing has been sent.']);
    expect(hindi).toContain(customerText('Send enquiry', 'hi'));
    expect(hindi).toContain('value="shop_delivery"');
    language.value = 'en';
    const english = renderToStaticMarkup(createElement(CartPanel, props));
    expect(english).toContain('Your goods price, transport charge, and any deposit');
    expect(english).toContain('<h3>Shop</h3>');
  });
  it('leaves no untranslated literal JSX copy or text attributes in the scoped components', () => {
    for (const path of ['CustomerApp.tsx', 'customer/CartPanel.tsx', 'customer/OrderPanel.tsx']) {
      const source = readFileSync(new URL(`../../src/components/${path}`, import.meta.url), 'utf8');
      const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const untranslated: string[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node) && /[A-Za-z]/.test(node.text)) untranslated.push(node.text.trim());
        if (ts.isJsxAttribute(node) && ['aria-label', 'placeholder', 'title'].includes(node.name.getText(ast)) && node.initializer && ts.isStringLiteral(node.initializer) && /[A-Za-z]/.test(node.initializer.text)) untranslated.push(node.initializer.text);
        ts.forEachChild(node, visit);
      };
      visit(ast);
      expect(untranslated, path).toEqual([]);
    }
  });
});
