export const CONSENT_KEY = 'pashu-saathi.analytics.v1';
export function analyticsConfig(env: Record<string, unknown>) {
  return {
    ga4: env.PUBLIC_ENABLE_ANALYTICS === 'true' && /^G-[A-Z0-9]{4,20}$/.test(String(env.PUBLIC_GA4_MEASUREMENT_ID ?? '')) ? String(env.PUBLIC_GA4_MEASUREMENT_ID) : null,
    clarity: env.PUBLIC_ENABLE_CLARITY === 'true' && /^[a-z0-9]{5,20}$/.test(String(env.PUBLIC_CLARITY_PROJECT_ID ?? '')) ? String(env.PUBLIC_CLARITY_PROJECT_ID) : null,
  };
}
export function publicAnalyticsRoute(url: URL): boolean {
  return !url.search && !url.hash && /^\/(?:|products\/(?:[a-z0-9-]+\/)?|categories\/(?:[a-z0-9-]+\/)?)$/.test(url.pathname);
}
export function readConsent(storage: Pick<Storage, 'getItem'>): boolean {
  try { return storage.getItem(CONSENT_KEY) === 'yes'; } catch { return false; }
}
export function saveConsent(storage: Pick<Storage, 'setItem'>, accepted: boolean): boolean {
  try { storage.setItem(CONSENT_KEY, accepted ? 'yes' : 'no'); return true; } catch { return false; }
}
export function pageView(url: URL) {
  return { page_location: url.origin + url.pathname, page_referrer: '', page_title: 'Public catalog' };
}

/** Permission lasts for this document only: a stale stored yes can never undo revocation. */
export function mountPublicAnalytics(options: {
  config: ReturnType<typeof analyticsConfig>;
  anonymous: () => Promise<boolean>;
  native: boolean;
  onSignIn?: (stop: () => void) => void;
}) {
  const { config } = options;
  const panel = document.querySelector<HTMLElement>('[data-analytics-consent]');
  const w = window as typeof window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void; clarity?: ((...args: unknown[]) => void) & { q?: unknown[][] }; [key: string]: unknown };
  let loaded = false;
  let allowed = false;
  let generation = 0;
  const eligible = () => !options.native && publicAnalyticsRoute(new URL(location.href));
  const status = (message: string) => { const el = panel?.querySelector('[data-analytics-status]'); if (el) el.textContent = message; };
  const script = (src: string) => { const tag = document.createElement('script'); tag.async = true; tag.src = src; tag.referrerPolicy = 'no-referrer'; document.head.append(tag); };
  function stop(destination?: URL, replace = true) {
    generation++; allowed = false;
    if (config.ga4) w[`ga-disable-${config.ga4}`] = true;
    w.gtag?.('consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied' });
    w.clarity?.('consent', false);
    try { saveConsent(localStorage, false); } catch { /* Permission is never restored from storage. */ }
    status('Analytics are off.');
    // A fresh document contains no provider code. The query disables collection even on reload.
    if (loaded) {
      const href = destination?.href ?? location.pathname + '?analytics=off';
      if (replace) location.replace(href); else location.assign(href);
    }
  }
  async function start() {
    const ticket = ++generation;
    if (!eligible() || loaded) return;
    let anonymous = false;
    try { anonymous = await options.anonymous(); } catch { /* Fail closed on identity uncertainty. */ }
    if (!anonymous || ticket !== generation || !allowed || !eligible()) return;
    loaded = true;
    if (config.ga4) {
      w[`ga-disable-${config.ga4}`] = false;
      w.dataLayer = [];
      w.gtag = function () { w.dataLayer!.push(arguments); };
      w.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
      w.gtag('js', new Date());
      w.gtag('config', config.ga4, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, page_location: location.origin + location.pathname, page_referrer: '', ignore_referrer: true });
      w.gtag('event', 'page_view', { ...pageView(new URL(location.href)), send_to: config.ga4 });
      script(`https://www.googletagmanager.com/gtag/js?id=${config.ga4}`);
    }
    if (config.clarity) {
      document.body.setAttribute('data-clarity-mask', 'true');
      const clarity = ((...args: unknown[]) => { clarity.q!.push(args); }) as NonNullable<typeof w.clarity>;
      clarity.q = []; w.clarity = clarity;
      clarity('consent', true);
      script(`https://www.clarity.ms/tag/${config.clarity}`);
    }
    status('Analytics allowed for this page only. Choose Keep analytics off to withdraw.');
  }
  if (!panel || !eligible() || !(config.ga4 || config.clarity)) return;
  panel.hidden = false;
  panel.querySelector('[data-analytics-accept]')?.addEventListener('click', () => { allowed = true; void start(); });
  panel.querySelector('[data-analytics-reject]')?.addEventListener('click', () => stop());
  window.addEventListener('storage', event => { if ((event.key === CONSENT_KEY || event.key === null) && event.newValue !== 'yes') stop(); });
  window.addEventListener('popstate', () => stop());
  window.addEventListener('hashchange', () => stop());
  // History mutations emit neither popstate nor hashchange. Unload providers BEFORE
  // exposing a new URL (including search text) to their history instrumentation.
  for (const name of ['pushState', 'replaceState'] as const) {
    const original = history[name].bind(history);
    history[name] = (data: unknown, unused: string, url?: string | URL | null) => {
      if (loaded) {
        // Validate before revoking or navigating, as the native History API does.
        const destination = new URL(url == null ? location.href : String(url), document.baseURI);
        if (destination.origin !== location.origin) throw new DOMException('History URL must be same-origin', 'SecurityError');
        structuredClone(data);
        // A full document navigation removes provider code. Consent is never restored.
        stop(destination, name === 'replaceState');
        return;
      }
      generation++; allowed = false;
      original(data, unused, url);
      panel.hidden = !eligible();
    };
  }
  options.onSignIn?.(stop);
}
