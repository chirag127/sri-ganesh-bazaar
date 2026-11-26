import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '../lib/api';
import { getCatalog, getCustomerOrders, getWorkspace, isConfigured, subscribeAuth } from '../lib/api';
import { signInGoogle, signOut } from '../lib/auth';
import { CART_EVENT, loadCart } from '../lib/cart';
import { formatDate, money } from '../lib/format';
import { customerFlowText, customerFlowFeedback, customerFlowStatus, type CustomerFlowKey } from '../lib/customer-flow-translations';
import type { CartLine, CatalogSnapshot, Order, Page, Workspace } from '../lib/types';
import CartPanel from './customer/CartPanel';
import OrderPanel from './customer/OrderPanel';
import AccountPanel from './customer/AccountPanel';
import './customer.css';
import ProductRequests from './ProductRequests';
import { useLanguage } from '../lib/use-language';
import { customerText, type CustomerTranslationKey } from '../lib/customer-translations';

type Tab = 'cart' | 'orders' | 'account' | 'requests';
function readTab(): Tab {
  const hash = typeof window === 'undefined' ? '' : window.location.hash.slice(1);
  return hash === 'orders' || hash === 'account' || hash === 'requests' ? hash : 'cart';
}

export default function CustomerApp() {
  const locale = useLanguage();
  const t = (key: CustomerTranslationKey) => customerText(key, locale);
  const f = (key: CustomerFlowKey, values?: Record<string, string | number>) => customerFlowText(key, locale, values);
  const feedback = (message: string) => customerFlowFeedback(message, locale);
  const [tab, setTab] = useState<Tab>(readTab);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [orders, setOrders] = useState<Page<Order> | null>(null);
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const subject = useRef<string | null>(null);
  const busyRef = useRef(false);
  const loadSequence = useRef(0);

  useEffect(() => {
    let active = true;
    const updateCart = () => setCart(loadCart());
    const updateTab = () => setTab(readTab());
    const connection = () => setOnline(navigator.onLine);
    updateCart(); updateTab(); connection();
    window.addEventListener(CART_EVENT, updateCart);
    window.addEventListener('storage', updateCart);
    window.addEventListener('hashchange', updateTab);
    window.addEventListener('online', connection); window.addEventListener('offline', connection);
    getCatalog().then((value) => { if (active) setCatalog(value); }).catch((failure: Error) => { if (active) setError(failure.message); });
    let unsubscribe = () => {};
    try {
      unsubscribe = subscribeAuth((value) => {
        if (!active) return;
        const nextId = value?.user.id ?? null;
        if (nextId !== subject.current) {
          subject.current = nextId;
          setWorkspace(null); setOrders(null); setSelected(null); setError(''); setNotice('');
          loadSequence.current += 1;
        }
        setSession(value); setAuthLoading(false);
      });
    } catch (failure) { setError((failure as Error).message); setAuthLoading(false); }
    return () => {
      active = false; unsubscribe(); loadSequence.current += 1;
      window.removeEventListener(CART_EVENT, updateCart); window.removeEventListener('storage', updateCart);
      window.removeEventListener('hashchange', updateTab); window.removeEventListener('online', connection); window.removeEventListener('offline', connection);
    };
  }, []);

  const reload = useCallback(async (offset = 0) => {
    const id = subject.current;
    if (!id) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const [nextWorkspace, nextOrders] = await Promise.all([getWorkspace(), getCustomerOrders(offset, 20)]);
      if (subject.current !== id || sequence !== loadSequence.current) return;
      setWorkspace(nextWorkspace); setOrders(nextOrders); setRevision((value) => value + 1);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session?.user.id) return;
    void reload().catch((failure: Error) => setError(failure.message));
  }, [session?.user.id, reload]);

  const perform = useCallback(async (label: string, task: () => Promise<void>, success = '') => {
    if (busyRef.current) return;
    busyRef.current = true; setBusyLabel(label); setError(''); setNotice('');
    const id = subject.current;
    try {
      await task();
      if (subject.current !== id) return;
      setNotice(success);
      if (id) {
        try { await reload(orders?.offset ?? 0); }
        catch { setError('Your action completed, but refreshed records could not be loaded. Do not repeat a payment; use Refresh.'); }
      }
    } catch (failure) {
      if (subject.current === id) setError((failure as Error).message || 'The action could not be completed.');
    } finally { busyRef.current = false; setBusyLabel(''); }
  }, [reload, orders?.offset]);

  const moveTab = (next: Tab) => { window.location.hash = next; setTab(next); };
  const login = () => { void perform('Opening Google sign-in', () => signInGoogle()); };
  const busy = Boolean(busyLabel);

  return <div className="customer-app">
    <header className="app-heading"><div><p className="eyebrow">{t("Your shop, in your pocket")}</p><h1>{t("From bag list to doorstep.")}</h1><p className="muted">{f('Enquire, approve a quote, and keep every order in one place.')}</p></div><div className="app-account-actions">
      {session ? <><span className="small">{workspace?.customer.name || f('Google account connected')}</span>{workspace?.is_admin && <a className="button secondary" href="/admin/">{t("Switch to admin")}</a>}<button className="text-button" type="button" disabled={busy} onClick={() => void perform('Signing out', () => signOut())}>{t("Sign out")}</button></> : <button className="button secondary" type="button" onClick={login} disabled={busy || authLoading || !isConfigured || !online}>{t("Continue with Google")}</button>}
    </div></header>
    {!isConfigured && <div className="notice setup-banner" role="status"><strong>{f('Setup preview — live ordering is not connected.')}</strong><p>{f('You can explore the public catalog and save a bag list on this device. No account, order, payment, or stock change is simulated.')}</p></div>}
    {!online && <p className="notice warning" role="status">{f('You are offline. Saved browsing and cart remain available; orders, quotes, and payments require a confirmed server response.')}</p>}
    <nav className="customer-tabs" aria-label={f('Your account sections')}>{([['cart','Bag list'],['orders','Orders'],['requests','Product requests'],['account','Account & dues']] as const).map(([value,label]) => <a href={`#${value}`} key={value} aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>{t(label)}{value === 'cart' && cart.length > 0 && <span className="tab-count">{cart.length}</span>}</a>)}</nav>
    <div aria-live="polite" className="app-feedback">{busyLabel && <p role="status">{feedback(busyLabel)}…</p>}{notice && <p className="notice">{feedback(notice)}</p>}{error && <p className="form-error" role="alert">{feedback(error)}</p>}</div>
    {tab === 'cart' && <CartPanel cart={cart} catalog={catalog} workspace={workspace} signedIn={Boolean(session)} online={online} busy={busy} perform={perform} onSignIn={login} onProfile={() => moveTab('account')} />}
    {tab !== 'cart' && !session && <section className="customer-panel empty-state"><h2>{authLoading ? f('Checking your session…') : f('Your history belongs to you.')}</h2><p>{f('Sign in with Google to view your orders, receipts, and account balance. Browsing the catalog does not require an account.')}</p><button type="button" className="button" onClick={login} disabled={busy || authLoading || !isConfigured || !online}>{t("Continue with Google")}</button></section>}
    {session && tab !== 'cart' && loading && <p role="status">{f('Refreshing your records…')}</p>}
    {session && tab === 'orders' && (selected ? <OrderPanel key={`${session.user.id}:${selected}`} orderId={selected} revision={revision} online={online} busy={busy} perform={perform} onClose={() => setSelected(null)} /> : <section className="customer-panel"><header className="panel-heading"><div><p className="eyebrow">{f('Everything recorded')}</p><h2>{t("Your orders")}</h2></div><button type="button" className="button secondary" disabled={loading || busy || !online} onClick={() => { setError(''); void reload(orders?.offset ?? 0).catch((failure: Error) => setError(failure.message)); }}>{t("Refresh")}</button></header>
      {orders?.items.length === 0 ? <div className="empty-state"><h3>{f('No enquiries yet.')}</h3><p>{f('Build your bag list and send your first enquiry. Final prices are always quoted before acceptance.')}</p><a className="button" href="/products/">{t("Browse products")}</a></div> : <ul className="order-list">{orders?.items.map((order) => <li key={order.id}><button type="button" onClick={() => setSelected(order.id)}><span><strong>{order.number}</strong><small>{feedback(formatDate(order.created_at))}</small><span>{order.lines.map((line) => `${line.quantity} × ${line.label}`).join(' · ')}</span></span><span className="order-list-end"><span className="status-label">{customerFlowStatus(order.status, locale)}</span><strong>{order.quote ? feedback(money(order.quote.total_paise)) : f('Awaiting quotation')}</strong><span className="muted">{f('View details →')}</span></span></button></li>)}</ul>}
      {orders && <div className="pagination"><button type="button" className="button secondary" disabled={loading || busy || !online || orders.offset === 0} onClick={() => void reload(Math.max(0, orders.offset - orders.limit)).catch((failure: Error) => setError(failure.message))}>{t("Previous")}</button><span>{orders.total === 0 ? f('0 orders') : f('{start}–{end} of {total}', { start: orders.offset + 1, end: orders.offset + orders.items.length, total: orders.total })}</span><button type="button" className="button secondary" disabled={loading || busy || !online || orders.offset + orders.items.length >= orders.total} onClick={() => void reload(orders.offset + orders.limit).catch((failure: Error) => setError(failure.message))}>{t("Next")}</button></div>}
    </section>)}
    {session && tab === 'account' && workspace && <AccountPanel key={session.user.id} workspace={workspace} online={online} busy={busy} perform={perform} />}
    {session && tab === 'requests' && <ProductRequests key={session.user.id} subject={session.user.id} online={online} />}
    <p className="small muted app-footnote">{f('If a connection interrupts a submission, check your history before trying again after a reload. This app never confirms a transaction offline.')}</p>
  </div>;
}
