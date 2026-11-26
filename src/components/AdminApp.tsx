import { useEffect, useRef, useState } from 'react';
import { command, request, getClient, getAdminWorkspace, getWorkspace, isConfigured, subscribeAuth } from '../lib/api';
import { signInGoogle, signOut } from '../lib/auth';
import type { AdminWorkspace, CommandName } from '../lib/types';
import Orders from './admin/Orders';
import Customers from './admin/Customers';
import Catalog from './admin/Catalog';
import { Counter, Ledger, Staff } from './admin/Operations';
import { AdminContext, ErrorNotice } from './admin/ui';
import { readableError } from './admin/model';
import './admin.css';
import ProductRequests from './ProductRequests';
import OwnerAnalytics from './admin/OwnerAnalytics';
import EstimateSettings, { EstimateSettingsContext, type EstimateRunner } from './admin/EstimateSettings';

import { useLanguage } from '../lib/use-language';
import { adminShellText } from '../lib/admin-shell-translations';

export default function AdminApp() {
  const locale = useLanguage();
  const t = (text: string) => adminShellText(text, locale);
  const [workspace,setWorkspace]=useState<AdminWorkspace|null>(null);
  const [subject,setSubject]=useState<string|null>(null);
  const [tab,setTab]=useState('orders');
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[online,setOnline]=useState(true);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
  const generation=useRef(0),lock=useRef(false);
  useEffect(()=>{let active=true;const connection=()=>setOnline(navigator.onLine);connection();window.addEventListener('online',connection);window.addEventListener('offline',connection);let unsubscribe=()=>{};
    try {unsubscribe=subscribeAuth(session=>{if(!active)return;generation.current++;setWorkspace(null);setSubject(session?.user.id??null);setLoading(false);setError('');setNotice('');});}catch(e){setError(readableError(e));setLoading(false);}
    return ()=>{active=false;generation.current++;unsubscribe();window.removeEventListener('online',connection);window.removeEventListener('offline',connection);};},[]);
  useEffect(()=>{if(!subject)return;let active=true;const version=generation.current;setLoading(true);void (async()=>{try{const role=await getWorkspace();if(!role.is_admin)throw new Error('This Google account does not have staff access. Use the customer view.');const data=await getAdminWorkspace();if(active&&version===generation.current)setWorkspace(data);}catch(e){if(active&&version===generation.current){setWorkspace(null);setError(readableError(e));}}finally{if(active&&version===generation.current)setLoading(false);}})();return()=>{active=false;};},[subject,revision]);
  const run=async(name:CommandName,payload:Record<string,unknown>,success:string)=>{if(lock.current||!online||!workspace)throw new Error('Wait for a connected, verified staff session.');lock.current=true;setBusy(true);setError('');const version=generation.current;try{const result=await command(name,payload);if(version!==generation.current)throw new Error('Account changed. Reload the current account before continuing.');setNotice(success);setRevision(v=>v+1);return result;}finally{lock.current=false;setBusy(false);}};
  const runSettings: EstimateRunner = async (action, payload) => {
    if (lock.current || loading || !online || !workspace || !subject) throw new Error('Verified online staff session required.');
    const version = generation.current, actor = subject;
    lock.current = true; setBusy(true); setError('');
    try {
      const session = await getClient().auth.getSession();
      if (session.error || session.data.session?.user.id !== actor || version !== generation.current) throw new Error('Account changed.');
      const result = await request<{request_id?: string}>('/rpc/estimate_settings_command', {p_action: action, p_payload: payload}, session.data.session.access_token);
      if (version !== generation.current) throw new Error('Account changed.');
      if (result?.request_id !== payload.request_id) throw new Error('Incomplete confirmation.');
      setNotice('Estimate settings saved by the server.'); setRevision(v => v + 1);
    } finally { lock.current = false; setBusy(false); }
  };
  const auth=async(task:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);try{await task();}catch(e){setError(readableError(e));}finally{lock.current=false;setBusy(false);}};
  return <div className="admin-app"><header className="admin-heading"><div><p className="admin-eyebrow">{t('Staff workspace')}</p><h1>{t('The shop, in order.')}</h1><p>{t('Quotes, packages and every rupee accounted for.')}</p></div><div className="admin-actions"><a className="admin-button admin-secondary" href="/app/">{t('Customer view')}</a><a href="/products/">{t('Public catalog')}</a>{subject&&<button className="admin-button admin-secondary" disabled={busy} onClick={()=>void auth(signOut)}>{t('Sign out')}</button>}</div></header>
    {!isConfigured&&<p className="admin-note">{t('Setup preview. The shop is not connected; no orders, stock or payments are simulated.')}</p>}{!online&&<p role="status" className="admin-note">{t('Offline. All administrative changes require a confirmed server response.')}</p>}<ErrorNotice error={t(error)}/>{notice&&<p role="status" className="admin-note">{t(notice)}</p>}{loading&&<p role="status">{t('Verifying staff access and refreshing records…')}</p>}
    {!subject&&<section className="admin-panel"><h2>{t('Authorized staff only')}</h2><p>{t('Sign in with Google. The server, not this page, decides who can administer the shop.')}</p><button className="admin-button" disabled={!isConfigured||busy||loading||!online} onClick={()=>void auth(signInGoogle)}>{t('Continue with Google')}</button></section>}
    {subject&&!loading&&!workspace&&<button className="admin-button" disabled={busy||!online} onClick={()=>setRevision(v=>v+1)}>{t('Retry access check')}</button>}
    {workspace&&<AdminContext.Provider value={{busy:busy||loading,online,revision,run}}><nav className="admin-nav" aria-label={t('Staff sections')}>{[['orders','Orders & enquiries'],['customers','Customers'],['counter','Counter sale'],['catalog','Products & stock'],['ledger','Ledger'],['reports','Reports'],['staff','Staff & requests']].map(([key,label])=><button key={key} type="button" aria-current={tab===key?'page':undefined} disabled={busy} onClick={()=>setTab(key)}>{t(label)}</button>)}</nav><EstimateSettingsContext.Provider value={runSettings}><div key={subject}>{tab==='orders'&&<Orders products={workspace.products}/ >}{tab==='customers'&&<Customers/>}{tab==='counter'&&<Counter products={workspace.products}/ >}{tab==='catalog'&&<Catalog workspace={workspace}/ >}{tab==='ledger'&&<Ledger/>}{tab==='reports'&&subject&&<OwnerAnalytics key={subject} subject={subject} online={online}/>}{tab==='staff'&&<><Staff workspace={workspace}/ ><EstimateSettings/>{subject && <ProductRequests key={subject} subject={subject} admin online={online} />}</>}</div></EstimateSettingsContext.Provider></AdminContext.Provider>}
  </div>;
}
