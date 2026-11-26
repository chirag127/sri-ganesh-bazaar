import { useEffect, useRef, useState } from 'react';
import { getClient, request } from '../../lib/api';
import { useLanguage } from '../../lib/use-language';
import { adminSettingsText } from '../../lib/admin-settings-translations';

type Report = { from_date: string; to_date: string; timezone: string; enquiries_created: number; accepted_orders_current: number; billed_sales: number; pending_requests_created: number; low_stock_now: number };
const rows = [
  ['enquiries_created', 'Enquiries submitted in period'],
  ['accepted_orders_current', 'Orders created in period currently accepted, ready, dispatched or completed'],
  ['billed_sales', 'Sales bills issued in period (not net of returns)'],
  ['pending_requests_created', 'Requests created in period still pending'],
  ['low_stock_now', 'Active variants at or below threshold now (not date-filtered)'],
] as const;
const analysisText: Record<string, string> = {
  'Analyze aggregate counts': 'समेकित गणनाओं का विश्लेषण करें',
  'Optional AI advice': 'वैकल्पिक एआई सलाह',
  'Analyzing counts…': 'गणनाओं का विश्लेषण हो रहा है…',
  'AI analysis is disabled.': 'एआई विश्लेषण बंद है।',
  'AI analysis is unavailable. No advice was generated.': 'एआई विश्लेषण उपलब्ध नहीं है। कोई सलाह नहीं बनी।',
  'Another analysis is still running. Try again later.': 'एक अन्य विश्लेषण चल रहा है। बाद में फिर प्रयास करें।',
  'Only the five aggregate counts are sent to a provider when enabled. No customer details, prices, dates or free text are sent. Counts are refreshed when you request advice.': 'सक्षम होने पर केवल पाँच समेकित गणनाएँ प्रदाता को भेजी जाती हैं। ग्राहक विवरण, कीमतें, तारीखें या मुक्त पाठ नहीं भेजे जाते। सलाह माँगने पर गणनाएँ फिर से ली जाती हैं।',
  'Unverified AI advice only. Check the counts and shop records before acting. This does not change orders, stock or money.': 'यह केवल अप्रमाणित एआई सलाह है। कार्रवाई से पहले गणनाएँ और दुकान के रिकॉर्ड जाँचें। इससे ऑर्डर, स्टॉक या पैसे नहीं बदलते।',
};

/** Plain text only: provider output never becomes HTML, Markdown, links or commands. */
export function AnalysisAdvice({ advice }: { advice: string }) {
  return <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{advice}</p>;
}

export default function OwnerAnalytics(props: { subject: string; online?: boolean }) {
  // Discard private results immediately when the account or connectivity changes.
  return <OwnerAnalyticsSession key={`${props.subject}:${props.online !== false}`} {...props} />;
}
function OwnerAnalyticsSession({ subject, online = true }: { subject: string; online?: boolean }) {
  const locale = useLanguage();
  const t = (text: string) => locale === 'hi' && analysisText[text] ? analysisText[text] : adminSettingsText(text, locale);
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [report, setReport] = useState<Report | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState(''); const [advice, setAdvice] = useState('');
  const generation = useRef(0); const lock = useRef(false);
  useEffect(() => () => { generation.current++; }, []);
  function clearResults() { generation.current++; setReport(null); setError(''); setAnalysis(''); setAdvice(''); }
  async function ownerRequest<T>(path: string, ticket: number): Promise<T> {
    const { data, error: sessionError } = await getClient().auth.getSession();
    const session = data.session;
    if (sessionError || !session || session.user.id !== subject || ticket !== generation.current) throw new Error('Session changed');
    return request<T>(path, { p_from: from, p_to: to }, session.access_token);
  }
  return <section className="admin-panel"><h2>{t('Private shop counts')}</h2><p>{t('Dates are inclusive in India time. These counts describe different stages and must not be added together. No customer details are sent to an AI service.')}</p>
    <form onSubmit={async event => { event.preventDefault(); if (!online || lock.current) return; lock.current = true; setBusy(true); clearResults(); const ticket = generation.current;
      try { const value = await ownerRequest<Report>('/rpc/owner_analytics', ticket);
        if (!value || value.from_date !== from || value.to_date !== to || value.timezone !== 'Asia/Kolkata' || rows.some(([key]) => !Number.isSafeInteger(value[key]) || value[key] < 0)) throw new Error();
        if (ticket === generation.current) setReport(value);
      } catch { if (ticket === generation.current) setError('Report unavailable. Check the dates and your owner access, then retry.'); }
      finally { lock.current = false; setBusy(false); }
    }}><fieldset disabled={busy || !online}><label>{t('From date')}<input type="date" required value={from} onChange={e => { clearResults(); setFrom(e.target.value); }} /></label><label>{t('Through date')}<input type="date" required min={from} value={to} onChange={e => { clearResults(); setTo(e.target.value); }} /></label><p>{t('Maximum 366 days.')}</p><button type="submit">{t('Load report')}</button></fieldset></form>
    {busy && <p role="status">{t('Loading counts…')}</p>}{!online && <p>{t('Reconnect to load a report. Reports are not stored offline.')}</p>}{error && <p role="alert">{t(error)}</p>}
    {report && <><table><caption>{report.from_date} {t('through')} {report.to_date} — Asia/Kolkata</caption><thead><tr><th scope="col">{t('Measure')}</th><th scope="col">{t('Count')}</th></tr></thead><tbody>{rows.map(([key, label]) => <tr key={key}><th scope="row">{t(label)}</th><td>{report[key]}</td></tr>)}</tbody></table>
      <h3>{t('Optional AI advice')}</h3><p>{t('Only the five aggregate counts are sent to a provider when enabled. No customer details, prices, dates or free text are sent. Counts are refreshed when you request advice.')}</p>
      <button type="button" disabled={busy || !online || analysis === 'loading'} onClick={async () => {
        if (!online || lock.current) return;
        lock.current = true; setAnalysis('loading'); setAdvice(''); const ticket = ++generation.current;
        try {
          const result = await ownerRequest<{ state: string; advice?: unknown; advisory_only?: unknown }>('/analysis', ticket);
          if (ticket !== generation.current) return;
          if (result?.state === 'complete' && result.advisory_only === true && typeof result.advice === 'string' && result.advice.trim() && new TextEncoder().encode(result.advice).length <= 8192) {
            setAdvice(result.advice); setAnalysis('complete');
          } else { setAnalysis(result?.state === 'disabled' || result?.state === 'busy' ? result.state : 'unavailable'); }
        } catch { if (ticket === generation.current) setAnalysis('unavailable'); }
        finally { lock.current = false; }
      }}>{t('Analyze aggregate counts')}</button>
      {analysis === 'loading' && <p role="status">{t('Analyzing counts…')}</p>}
      {analysis === 'disabled' && <p role="status">{t('AI analysis is disabled.')}</p>}
      {analysis === 'busy' && <p role="status">{t('Another analysis is still running. Try again later.')}</p>}
      {analysis === 'unavailable' && <p role="alert">{t('AI analysis is unavailable. No advice was generated.')}</p>}
      {advice && <><p>{t('Unverified AI advice only. Check the counts and shop records before acting. This does not change orders, stock or money.')}</p><AnalysisAdvice advice={advice} /></>}
    </>}
  </section>;
}
