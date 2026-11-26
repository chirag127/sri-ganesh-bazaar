export interface CartEstimate {
  goods_total_paise: number;
  delivery_min_paise: number | null;
  delivery_max_paise: number | null;
  total_min_paise: number | null;
  total_max_paise: number | null;
  approximate: true;
  reserves_stock: false;
}

/** Reconstruct totals only; never retain extra fields or private unit prices. */
export function parseCartEstimate(input: unknown): CartEstimate {
  const invalid = () => { throw new Error('The shop returned an invalid estimate. Request a quotation instead.'); };
  if (!input || typeof input !== 'object') return invalid();
  const x = input as Record<string, unknown>;
  const amount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  if (!amount(x.goods_total_paise) || x.approximate !== true || x.reserves_stock !== false) return invalid();
  const fields = ['delivery_min_paise', 'delivery_max_paise', 'total_min_paise', 'total_max_paise'] as const;
  const allNull = fields.every(k => x[k] === null);
  if (!allNull) {
    if (!fields.every(k => amount(x[k]))) return invalid();
    const min = x.delivery_min_paise as number, max = x.delivery_max_paise as number;
    if (min > max || !Number.isSafeInteger(x.goods_total_paise + max)
      || x.total_min_paise !== x.goods_total_paise + min || x.total_max_paise !== x.goods_total_paise + max) return invalid();
  }
  return { goods_total_paise: x.goods_total_paise, delivery_min_paise: x.delivery_min_paise as number | null,
    delivery_max_paise: x.delivery_max_paise as number | null, total_min_paise: x.total_min_paise as number | null,
    total_max_paise: x.total_max_paise as number | null, approximate: true, reserves_stock: false };
}

/** Generation tokens prevent a late response from restoring a cleared estimate. */
export function createEstimateGuard() {
  let generation = 0;
  return { invalidate: () => { generation++; }, begin: () => ++generation, current: (token: number) => token === generation };
}
