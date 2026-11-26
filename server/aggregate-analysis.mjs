export const COUNT_FIELDS = Object.freeze(['enquiries_created', 'accepted_orders_current', 'billed_sales', 'pending_requests_created', 'low_stock_now']);
const MAX_REQUEST_BYTES = 1024;
const MAX_RESPONSE_BYTES = 8192;

/** Only counts, not the complete owner report or arbitrary prompt text, cross this boundary. */
export function aggregateCounts(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid aggregate counts');
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('Invalid aggregate counts');
  const keys = Reflect.ownKeys(input);
  if (keys.length !== COUNT_FIELDS.length || keys.some(key => !COUNT_FIELDS.includes(key))) throw new Error('Invalid aggregate counts');
  const counts = {};
  for (const key of COUNT_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !('value' in descriptor) || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) throw new Error('Invalid aggregate counts');
    counts[key] = descriptor.value;
  }
  if (Buffer.byteLength(JSON.stringify(counts)) > MAX_REQUEST_BYTES) throw new Error('Aggregate request too large');
  return Object.freeze(counts);
}

/** Injectable boundary, not a configured provider. Caller must authorize the owner first.
 * Provider must honor signal and bound its network response before materializing text.
 * Returned text is untrusted advice: render as text, never parse HTML/Markdown,
 * execute it, follow embedded links automatically, or apply mutations.
 * This boundary does not verify the factual accuracy of provider advice.
 */
export function createAggregateAnalysis({ enabled = false, provider, timeoutMs = 5000 } = {}) {
  let busy = false;
  return async input => {
    if (enabled !== true) return { state: 'disabled' };
    if (typeof provider !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) return { state: 'unavailable' };
    let counts;
    try { counts = aggregateCounts(input); } catch { return { state: 'invalid' }; }
    if (busy) return { state: 'busy' };
    busy = true;
    const controller = new AbortController();
    let timer;
    const deadline = new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ state: 'unavailable' }); }, timeoutMs); });
    // Keep the lock until the provider settles, even if it ignores cancellation.
    const attempt = Promise.resolve().then(() => provider(counts, { signal: controller.signal, maxResponseBytes: MAX_RESPONSE_BYTES }))
      .then(text => {
        if (controller.signal.aborted || typeof text !== 'string' || text.length > MAX_RESPONSE_BYTES || Buffer.byteLength(text) > MAX_RESPONSE_BYTES || !text.trim()) return { state: 'unavailable' };
        return { state: 'complete', advice: text, advisory_only: true };
      }, () => ({ state: 'unavailable' }))
      .finally(() => { busy = false; });
    try { return await Promise.race([attempt, deadline]); }
    finally { clearTimeout(timer); }
  };
}
