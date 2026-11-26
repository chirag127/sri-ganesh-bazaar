import { createContext, useContext, useEffect, useId, useRef, useState, type DependencyList, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { getCommercePage } from '../../lib/api';
import { useAdminCommerceText } from '../../lib/admin-commerce-translations';
import { labelStatus, money } from '../../lib/format';
import type { CommandName, CommandResult, Customer, Page } from '../../lib/types';
import { PAGE_SIZE, readableError } from './model';

export interface AdminControls {
  busy: boolean;
  online: boolean;
  revision: number;
  run: (name: CommandName, payload: Record<string, unknown>, success: string) => Promise<CommandResult>;
}
export const AdminContext = createContext<AdminControls | null>(null);
export function useAdmin(): AdminControls {
  const context = useContext(AdminContext);
  if (!context) throw new Error('Admin controls require a verified staff session.');
  return context;
}
export function Input({ label, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const t = useAdminCommerceText();
  const id = useId();
  return <label className="admin-field" htmlFor={id}><span>{t(label)}</span><input id={id} {...props} aria-describedby={hint ? `${id}-hint` : undefined} />{hint && <small id={`${id}-hint`}>{t(hint)}</small>}</label>;
}
export function TextArea({ label, hint, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  const t = useAdminCommerceText();
  const id = useId();
  return <label className="admin-field" htmlFor={id}><span>{t(label)}</span><textarea id={id} rows={3} maxLength={2000} {...props} aria-describedby={hint ? `${id}-hint` : undefined} />{hint && <small id={`${id}-hint`}>{t(hint)}</small>}</label>;
}
export function Select({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const t = useAdminCommerceText();
  const id = useId();
  return <label className="admin-field" htmlFor={id}><span>{t(label)}</span><select id={id} {...props}>{children}</select></label>;
}
export function Check({ children, ...props }: InputHTMLAttributes<HTMLInputElement> & { children: ReactNode }) {
  const t = useAdminCommerceText();
  return <label className="admin-check"><input type="checkbox" {...props} /><span>{typeof children === 'string' ? t(children) : children}</span></label>;
}
export function Status({ value }: { value: string }) { return <span className={`admin-status admin-status-${value}`}>{labelStatus(value)}</span>; }
export function Empty({ children }: { children: ReactNode }) { return <p className="admin-empty">{children}</p>; }
export function ErrorNotice({ error }: { error: string }) { return error ? <p className="admin-error" role="alert">{error}</p> : null; }
export function Balance({ value }: { value: number | undefined }) {
  const t = useAdminCommerceText();
  if (value === undefined || !Number.isSafeInteger(value)) return <p className="admin-muted">{t('Full account balance unavailable. No total is inferred from the displayed entries.')}</p>;
  return <dl className="admin-balance"><dt>{t(value > 0 ? 'Customer dues' : value < 0 ? 'Customer advance / credit' : 'Account settled')}</dt><dd>{money(Math.abs(value))}</dd><dt className="admin-muted">{t('Authoritative full-ledger balance')}</dt></dl>;
}
export function Panel({ title, subtitle, children, actions }: { title: string; subtitle?: string; children: ReactNode; actions?: ReactNode }) {
  const t = useAdminCommerceText();
  return <section className="admin-panel"><header className="admin-panel-heading"><div><h2>{t(title)}</h2>{subtitle && <p className="admin-muted">{t(subtitle)}</p>}</div>{actions}</header>{children}</section>;
}

export interface PreparedAction { payload: Record<string, unknown>; summary: ReactNode }
interface ActionFormProps {
  name: CommandName;
  label: string;
  prepare: (data: FormData) => PreparedAction;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSuccess?: (result: CommandResult) => void;
}
export function ActionForm({ name, label, prepare, children, danger, disabled, onSuccess }: ActionFormProps) {
  const t = useAdminCommerceText();
  const { run, busy, online } = useAdmin();
  const [prepared, setPrepared] = useState<PreparedAction | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const lock = useRef(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  const errorId = useId();
  useEffect(() => { if (prepared) confirmRef.current?.focus(); }, [prepared]);
  const send = async () => {
    if (!prepared || lock.current || busy || !online || disabled) return;
    lock.current = true; setSubmitting(true); setError('');
    try {
      const result = await run(name, prepared.payload, `${label}: recorded by the server.`);
      setPrepared(null); onSuccess?.(result);
    } catch (failure) { setError(readableError(failure)); }
    finally { lock.current = false; setSubmitting(false); }
  };
  return <form className="admin-action-form" aria-describedby={error ? errorId : undefined} onSubmit={(event) => {
    event.preventDefault();
    if (busy || submitting || disabled || !online || prepared) return;
    setError('');
    try { setPrepared(prepare(new FormData(event.currentTarget))); }
    catch (failure) { setError(readableError(failure)); }
  }}>
    <fieldset disabled={busy || submitting || disabled || !online || Boolean(prepared)}>{children}</fieldset>
    {error && <p id={errorId} role="alert" className="admin-error">{error}</p>}
    {prepared ? <div className="admin-confirm" ref={confirmRef} tabIndex={-1} role="group" aria-label={`Confirm ${label}`}>
      <h4>{t('Review before recording')}</h4><div>{prepared.summary}</div><p className="admin-muted">{t('This is a real server change. Posted stock and financial history cannot simply be erased.')}</p>
      <div className="admin-actions"><button type="button" className={danger ? 'admin-button admin-danger' : 'admin-button'} disabled={busy || submitting || !online || disabled} onClick={() => void send()}>{submitting ? t('Recording…') : `${t('Confirm')} ${t(label)}`}</button><button type="button" className="admin-button admin-secondary" disabled={busy || submitting} onClick={() => { setPrepared(null); setError(''); }}>{t('Back to edit')}</button></div>
    </div> : <button type="submit" className={danger ? 'admin-button admin-danger' : 'admin-button'} disabled={busy || submitting || !online || disabled}>{t('Review')} {t(label)}</button>}
  </form>;
}

export function useResource<T>(loader: () => Promise<T>, dependencies: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void loader().then((result) => { if (active) setData(result); }).catch((failure) => {
      if (active) { setData(null); setError(readableError(failure)); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // Callers explicitly key requests by subject, entity, search, page and revision.
  }, [...dependencies, retry]);
  return { data, error, loading, retry: () => setRetry((value) => value + 1) };
}
export function usePage<T>(entity: 'orders' | 'customers' | 'ledger' | 'bills' | 'submissions') {
  const { revision } = useAdmin();
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const resource = useResource<Page<T>>(() => getCommercePage<T>(entity, query, offset, PAGE_SIZE), [entity, query, offset, revision]);
  return { ...resource, query, search: (value: string) => { setQuery(value.trim().slice(0, 100)); setOffset(0); }, setOffset };
}
export function Search({ label, onSearch, disabled, initial = '' }: { label: string; onSearch: (value: string) => void; disabled?: boolean; initial?: string }) {
  const t = useAdminCommerceText();
  return <form className="admin-search" role="search" onSubmit={(event) => { event.preventDefault(); onSearch(String(new FormData(event.currentTarget).get('query') ?? '')); }}>
    <Input label={label} name="query" type="search" maxLength={100} defaultValue={initial} /><button className="admin-button admin-secondary" type="submit" disabled={disabled}>{t('Search')}</button>
  </form>;
}
export function Pager({ page, onPage, disabled, noun = 'records' }: { page: Page<unknown> | null; onPage: (offset: number) => void; disabled?: boolean; noun?: string }) {
  const t = useAdminCommerceText();
  if (!page) return null;
  return <nav className="admin-pagination" aria-label={`${noun} pages`}><button className="admin-button admin-secondary" type="button" disabled={disabled || page.offset <= 0} onClick={() => onPage(Math.max(0, page.offset - page.limit))}>{t('Previous')}</button><span role="status">{page.total ? `${page.offset + (page.items.length ? 1 : 0)}–${page.offset + page.items.length} of ${page.total} ${noun}` : `No ${noun}`}</span><button className="admin-button admin-secondary" type="button" disabled={disabled || !page.items.length || page.offset + page.items.length >= page.total} onClick={() => onPage(page.offset + page.limit)}>{t('Next')}</button></nav>;
}
export function CustomerPicker({ customer, onChange }: { customer: Customer | null; onChange: (customer: Customer | null) => void }) {
  const t = useAdminCommerceText();
  const { revision, online, busy } = useAdmin();
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const { data, error, loading, retry } = useResource(() => getCommercePage<Customer>('customers', query, offset, 10), [query, offset, revision]);
  const lookup = () => { setQuery(draft.trim()); setOffset(0); };
  return <div className="admin-customer-picker">
    <div className="admin-search"><Input label="Find a customer" type="search" value={draft} maxLength={100} placeholder="Name, phone, or email" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); lookup(); } }} /><button type="button" className="admin-button admin-secondary" disabled={loading || busy || !online} onClick={lookup}>{t('Search directory')}</button></div>
    <ErrorNotice error={error} />{error && <button type="button" className="admin-button admin-secondary" disabled={loading || !online} onClick={retry}>{t('Retry directory')}</button>}
    {loading && <p role="status">{t('Searching customers…')}</p>}
    <Select label="Customer for this transaction" value={customer?.id ?? ''} disabled={loading || busy || !online} onChange={(event) => onChange(data?.items.find((item) => item.id === event.target.value) ?? (customer?.id === event.target.value ? customer : null))}>
      <option value="">{t('Select a customer')}</option>{customer && !data?.items.some((item) => item.id === customer.id) && <option value={customer.id}>{customer.name} — {customer.phone || customer.email || customer.id}</option>}{data?.items.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.phone || item.email || item.id}</option>)}
    </Select>
    <Pager page={data} onPage={setOffset} disabled={loading || busy || !online} noun="matching customers" />
    {customer && <p className="admin-muted">Selected: <strong>{customer.name}</strong>. {customer.phone || 'No phone recorded'}. Customer ID: <span className="admin-id">{customer.id}</span></p>}
  </div>;
}
