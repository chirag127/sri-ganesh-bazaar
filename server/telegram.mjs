const templates = Object.freeze({
  new_enquiry: 'A new enquiry needs review. Open the admin app.',
  quote_accepted: 'A quotation was accepted. Open the admin app.',
  payment_submitted: 'Payment evidence needs verification. Open the admin app.',
  low_stock: 'An item has reached its stock threshold. Open the admin app.',
  application_error: 'The shop recorded an application error. Check the private error monitor.',
});

/** Transport only. Durable claiming, deduplication and retry scheduling belong to the outbox. */
export function createTelegramTransport({ enabled = false, token, chatId, fetcher = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const configured = typeof token === 'string' && /^[1-9][0-9]{4,19}:[A-Za-z0-9_-]{30,100}$/.test(token)
    && typeof chatId === 'string' && /^-?[1-9][0-9]{0,19}$/.test(chatId)
    && typeof fetcher === 'function' && Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 30000;
  return { async send(event) {
    if (enabled !== true) return { state: 'failed', reason: 'disabled' };
    if (!configured) return { state: 'failed', reason: 'configuration' };
    if (typeof event !== 'string' || !Object.hasOwn(templates, event)) return { state: 'failed', reason: 'unknown_event' };
    const controller = new AbortController();
    let timer;
    // Race also bounds injected transports that ignore AbortSignal. A timeout cannot prove non-delivery.
    const deadline = new Promise(resolve => { timer = setTimeout(() => {
      controller.abort(); resolve({ state: 'uncertain', reason: 'timeout' });
    }, timeoutMs); });
    const attempt = (async () => {
      try {
        const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: templates[event], protect_content: true, allow_paid_broadcast: false }),
        });
        // Never retain provider descriptions: they may contain credentials or request data.
        let body;
        try { body = await response.json(); } catch { body = null; }
        if (response.status === 429 || body?.error_code === 429) {
          const seconds = body?.parameters?.retry_after;
          return { state: 'failed', reason: 'rate_limited', ...(Number.isSafeInteger(seconds) && seconds > 0 ? { retry_after: seconds } : {}) };
        }
        if (response.ok && body?.ok === true && Number.isSafeInteger(body?.result?.message_id) && body.result.message_id > 0) {
          return { state: 'sent', provider_id: String(body.result.message_id) };
        }
        if (response.status >= 400 && response.status < 500 && response.status !== 408) return { state: 'failed', reason: 'rejected' };
        return { state: 'uncertain', reason: 'unconfirmed' };
      } catch { return { state: 'uncertain', reason: 'transport' }; }
    })();
    try { return await Promise.race([attempt, deadline]); }
    finally { clearTimeout(timer); }
  } };
}
