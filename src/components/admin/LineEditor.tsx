import { AdminText } from '../../lib/admin-commerce-translations';
import { useRef } from 'react';
import { money } from '../../lib/format';
import type { AdminProduct as Product } from '../../lib/types';
import { goodsTotal, priceLines, rupees, type DraftLine } from './model';
import { Input, Select } from './ui';

export default function LineEditor({ products, lines, onChange }: { products: Product[]; lines: DraftLine[]; onChange: (lines: DraftLine[]) => void }) {
  const nextKey = useRef(Math.max(0, ...lines.map((line) => line.key)) + 1);
  const variants = products.flatMap((product) => product.variants.map((variant) => ({ ...variant, product_name: product.name, active: product.active })));
  const update = (key: number, change: Partial<DraftLine>) => onChange(lines.map((line) => line.key === key ? { ...line, ...change } : line));
  let total: number | null = null;
  try { total = goodsTotal(priceLines(lines)); } catch { /* Incomplete drafts are not monetary totals. */ }
  return <div className="admin-line-editor">
    <p className="admin-muted"><AdminText text="Whole bags/packages only. Prices below are rupees per package, not per kilogram."/ ></p>
    {lines.map((line, index) => <div className="admin-line" key={line.key}>
      <Select label={`Package ${index + 1}`} value={line.variant_id} required onChange={(event) => {
        const variant = variants.find((item) => item.id === event.target.value);
        update(line.key, { variant_id: event.target.value, price: variant ? rupees(variant.reference_price_paise) : '' });
      }}><option value=""><AdminText text="Choose a product / package"/ ></option>{line.variant_id && !variants.some((item) => item.id === line.variant_id) && <option value={line.variant_id}>Historical package — {line.variant_id}</option>}{variants.map((variant) => <option key={variant.id} value={variant.id} disabled={!variant.active && variant.id !== line.variant_id}>{variant.product_name} — {variant.label}{!variant.active ? ' (inactive)' : ''}</option>)}</Select>
      <Input label={`Packages, line ${index + 1}`} type="number" inputMode="numeric" min="1" max="10000" step="1" value={line.quantity} required onChange={(event) => update(line.key, { quantity: event.target.value })} />
      <Input label={`Unit price (₹), line ${index + 1}`} inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={line.price} required onChange={(event) => update(line.key, { price: event.target.value })} />
      <button type="button" className="admin-button admin-secondary" aria-label={`Remove package line ${index + 1}`} onClick={() => onChange(lines.filter((item) => item.key !== line.key))}><AdminText text="Remove"/ ></button>
    </div>)}
    <div className="admin-actions"><button type="button" className="admin-button admin-secondary" disabled={lines.length >= 100 || !variants.some((variant) => variant.active)} onClick={() => onChange([...lines, { key: nextKey.current++, variant_id: '', quantity: '1', price: '' }])}><AdminText text="Add package"/ ></button><p><strong>Draft goods subtotal: {total === null ? 'Complete all lines' : money(total)}</strong></p></div>
  </div>;
}
