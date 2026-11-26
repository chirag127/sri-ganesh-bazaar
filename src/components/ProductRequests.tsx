import { useEffect, useRef, useState } from 'react';
import { getClient, request } from '../lib/api';
import { useLanguage } from '../lib/use-language';
import { customerText, type CustomerTranslationKey } from '../lib/customer-translations';
interface Row { id: string; description: string; status: string; resolution: string; }
interface Page { items: Row[]; total: number; }
export default function ProductRequests({ subject, admin = false, online = true }: { subject: string; admin?: boolean; online?: boolean }) {
  const locale = useLanguage();
  const t = (key: CustomerTranslationKey) => customerText(key, locale);
  const [page, setPage] = useState<Page | null>(null), [offset, setOffset] = useState(0), [revision, setRevision] = useState(0);
  const [description, setDescription] = useState(''), [error, setError] = useState<CustomerTranslationKey | ''>(''), [busy, setBusy] = useState(false);
  const lock = useRef(false), generation = useRef(0), retry = useRef<{key:string; id:string} | null>(null);
  useEffect(() => { const version = ++generation.current; setPage(null); if (online) void request<Page>('/rpc/product_requests_page', {p_admin:admin,p_limit:20,p_offset:offset}).then(p => { if(version===generation.current)setPage(p); }).catch(() => {if(version===generation.current)setError('Requests could not be loaded. Reconnect and refresh.');}); return () => { generation.current++; }; }, [subject,admin,online,offset,revision]);
  async function save(action: string, payload: Record<string, unknown>) {
    if(lock.current || !online)return;
    lock.current=true;setBusy(true);setError('');const version=generation.current;
    try {
      const session=await getClient().auth.getSession();
      if(session.error || session.data.session?.user.id!==subject || version!==generation.current)throw Error();
      const key=JSON.stringify([subject,action,payload]);if(retry.current?.key!==key)retry.current={key,id:crypto.randomUUID()};
      const result=await request<{request_id:string}>('/rpc/product_request_command',{p_action:action,p_payload:{...payload,request_id:retry.current.id}},session.data.session.access_token);
      if(version!==generation.current)return;
      if(result.request_id!==retry.current.id)throw Error();
      retry.current=null;setDescription('');setRevision(v=>v+1);
    } catch { if(version===generation.current)setError('Request not confirmed. Refresh history before retrying; unchanged retries reuse the request ID.'); }
    finally {lock.current=false;setBusy(false);}
  }
  return <section className="customer-panel"><h2>{t(admin?'Product requests':'Request a product')}</h2><p>{t('Unavailable or unlisted items. This records your requirements only, not an order, quote, payment, or reservation.')}</p>
    {!admin && <form onSubmit={e=>{e.preventDefault();void save('create',{description:description.trim()});}}><label>{t('Requirements in Hindi or English')}<textarea required maxLength={2000} value={description} disabled={busy||!online} onChange={e=>setDescription(e.target.value)} /></label><button disabled={busy||!online||!description.trim()}>{t('Send product request')}</button></form>}
    {error&&<p role="alert">{t(error)}</p>}{!online && <p role="status">{t('Offline. Reconnect to load or send product requests.')}</p>}{online && !page && !error && <p role="status">{t('Loading requests…')}</p>}<button disabled={busy||!online} onClick={()=>{setError('');setRevision(v=>v+1);}}>{t('Refresh requests')}</button>
    <ul>{page?.items.map(row=><li key={row.id}><p>{row.description}</p><strong>{row.status === 'pending' ? t('Pending') : row.status === 'resolved' ? t('Resolved') : row.status}</strong><p>{row.resolution}</p>{admin&&<form onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);void save('update',{id:row.id,status:d.get('status'),resolution:d.get('resolution')});}}><label>{t('Status')}<select name="status" defaultValue={row.status}><option value="pending">{t('Pending')}</option><option value="resolved">{t('Resolved')}</option></select></label><label>{t('Customer-visible response')}<textarea name="resolution" required maxLength={2000} defaultValue={row.resolution}/></label><button disabled={busy||!online}>{t('Save response')}</button></form>}</li>)}</ul>
    {page?.total===0&&<p>{t('No product requests yet.')}</p>}<button disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>{t('Previous requests')}</button><button disabled={busy||!page||offset+20>=page.total} onClick={()=>setOffset(offset+20)}>{t('Next requests')}</button>
  </section>;
}
