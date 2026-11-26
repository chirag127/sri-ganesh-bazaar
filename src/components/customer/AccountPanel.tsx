import { useEffect, useState, type FormEvent } from 'react';
import { command, getCommercePage } from '../../lib/api';
import { confirmSms, requestPush, requestSms } from '../../lib/auth';
import { formatDate, labelStatus, money } from '../../lib/format';
import type { LedgerEntry, Page, Workspace } from '../../lib/types';
import type { ActionProps } from './CartPanel';
import { useLanguage } from '../../lib/use-language';
import { customerText, type CustomerTranslationKey } from '../../lib/customer-translations';
import { accountText, accountFeedback, accountStatus, type AccountTranslationKey } from '../../lib/account-translations';

interface Props extends ActionProps { workspace: Workspace; online: boolean; }
export function normalizeIndianPhone(input: string): string {
  const compact = input.replace(/[\s()-]/g, '');
  const national = compact.startsWith('+91') ? compact.slice(3) : compact;
  if (!/^[6-9]\d{9}$/.test(national)) throw new Error('Enter a valid 10-digit Indian mobile number, optionally beginning with +91.');
  return `+91${national}`;
}

export default function AccountPanel({ workspace, online, busy, perform }: Props) {
  const locale = useLanguage();
  const t = (key: CustomerTranslationKey) => customerText(key, locale);
  const a = (key: AccountTranslationKey) => accountText(key, locale);
  const status = (value: string) => accountStatus(value, locale, labelStatus);
  const performAccount: ActionProps['perform'] = (label, task, success) => perform(
    accountFeedback(label, locale),
    async () => {
      try { await task(); }
      catch (error) {
        if (error instanceof Error && accountFeedback(error.message, locale) !== error.message) {
          throw new Error(accountFeedback(error.message, locale));
        }
        throw error;
      }
    },
    success === undefined ? undefined : accountFeedback(success, locale),
  );
  const [name, setName] = useState(workspace.customer.name);
  const [phone, setPhone] = useState(workspace.customer.phone ?? '');
  const [address, setAddress] = useState(workspace.customer.address ?? '');
  const [code, setCode] = useState('');
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConsent, setDeleteConsent] = useState(false);
  const [ledgerPage, setLedgerPage] = useState<Page<LedgerEntry> | null>(null);
  const [ledgerError, setLedgerError] = useState('');
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const smsEnabled = import.meta.env.PUBLIC_ENABLE_SMS === 'true';
  const pushEnabled = import.meta.env.PUBLIC_ENABLE_PUSH === 'true';
  useEffect(() => { setName(workspace.customer.name); setPhone(workspace.customer.phone ?? ''); setAddress(workspace.customer.address ?? ''); setLedgerPage(null); }, [workspace]);

  async function save(event: FormEvent) {
    event.preventDefault();
    await performAccount('Saving contact details', async () => {
      const nextPhone = normalizeIndianPhone(phone);
      await command('save_profile', { name: name.trim(), phone: nextPhone, address: address.trim() || null });
      if (nextPhone !== workspace.customer.phone) { setAwaitingCode(false); setCode(''); }
    }, 'Contact details saved. Changing your number resets its verification status.');
  }
  async function pageLedger(offset: number) {
    if (ledgerBusy) return;
    setLedgerBusy(true); setLedgerError('');
    try { setLedgerPage(await getCommercePage<LedgerEntry>('ledger', '', offset, 20)); }
    catch (error) { setLedgerError((error as Error).message); }
    finally { setLedgerBusy(false); }
  }
  const ledger = ledgerPage?.items ?? workspace.ledger.slice(0, 20);
  const balance = workspace.balance_paise;
  const pendingDeletion = workspace.deletion_requests?.some((request) => ['requested', 'processing'].includes(request.status));

  return <div className="account-sections" lang={locale}>
    <section className="customer-panel" aria-labelledby="profile-title"><p className="eyebrow">{t("Your account")}</p><h2 id="profile-title">{t("Contact details")}</h2><p className="muted">{a('Google account:')} {workspace.customer.email ?? a('Connected')}. {a('Your mobile number is recorded separately.')}</p>
      <form className="stack-form" onSubmit={save}>
        <label>{t("Name")}<input value={name} onChange={(event) => setName(event.currentTarget.value)} required minLength={2} maxLength={120} autoComplete="name" disabled={busy} /></label>
        <label>{t("Indian mobile number")} <span aria-hidden="true">*</span><input type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.currentTarget.value)} required maxLength={20} autoComplete="tel" placeholder="+91 98765 43210" disabled={busy} /><small>{a('Required for order contact. Google sign-in does not verify this number.')}</small></label>
        <label>{t("Usual address")} <span className="muted">{t("Optional")}</span><textarea value={address} onChange={(event) => setAddress(event.currentTarget.value)} maxLength={1000} rows={3} autoComplete="street-address" disabled={busy} /></label>
        <button type="submit" className="button" disabled={busy || !online}>{t("Save contact details")}</button>
      </form>
      <div className="verification-box"><h3>{a('Phone status:')} {status(workspace.customer.phone_status)}</h3><p className="small muted">{a("Staff confirmation and SMS verification are distinct. Neither lets someone claim another customer's order history.")}</p>
        <div id="sms-recaptcha" aria-label={a('Phone verification security check')} />
        {workspace.customer.phone_status === 'unverified' && <>
          {smsEnabled ? <><p>{a("Save your number first. SMS verification is subject to the shop's daily allowance and provider availability; staff can confirm your contact if it is unavailable.")}</p><button type="button" className="button secondary" disabled={busy || !online || !workspace.customer.phone || phone !== workspace.customer.phone} onClick={() => void performAccount('Requesting phone verification', async () => {
            const result = await requestSms(workspace.customer.phone!);
            setAwaitingCode(result.status === 'code_sent');
          }, 'Verification request processed. If a code was sent, enter it below. No code is required at every Google sign-in.')} >{t("Send verification code")}</button>
          {awaitingCode && <form className="stack-form" onSubmit={(event) => { event.preventDefault(); void performAccount('Checking verification code', async () => { await confirmSms(code.trim()); setAwaitingCode(false); setCode(''); }, 'Phone verification completed.'); }}><label>{t("SMS code")}<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.currentTarget.value)} required pattern="[0-9]{6}" maxLength={6} disabled={busy} /></label><button type="submit" className="button" disabled={busy || !online}>{t("Verify code")}</button></form>}</> : <p>{a('SMS is not enabled. The shop can confirm your number by a manual call or in person.')} <a href="/contact/">{t("Contact the shop")}</a>.</p>}
        </>}
      </div>
      <h3>{t("Order notifications")}</h3><p>{a('Order history is always the record of your order. Optional push notifications are best-effort and may be delayed or blocked by your device.')}</p><button type="button" className="button secondary" disabled={busy || !online || !pushEnabled} onClick={() => void performAccount('Enabling notifications', async () => { await requestPush(); }, 'Notification preference processed. Check your browser or Android permission setting.')}>{t("Enable push notifications")}</button>{!pushEnabled && <p className="small muted">{a('Push notifications will become available after the shop completes setup.')}</p>}
    </section>
    <section className="customer-panel" aria-labelledby="balance-title"><p className="eyebrow">{t("Advances & dues")}</p><h2 id="balance-title">{t("Your shop account")}</h2><p className="balance-value">{money(Math.abs(balance))}</p><p><strong>{a(balance > 0 ? 'Net amount due to the shop' : balance < 0 ? 'Net advance / credit recorded with the shop' : 'Your recorded account is balanced')}</strong></p><p className="small muted">{a('This is a shop ledger, not a transferable payment wallet. Deposits can be allocated to orders. Pending UPI references do not count as confirmed receipts. An account credit is not automatically a refundable cash balance.')}</p>
      <h3>{t(ledgerPage ? 'Account entries' : 'Recent account entries')}</h3>{ledger.length === 0 ? <p className="muted">{a('No financial entries have been posted.')}</p> : <ul className="record-list">{ledger.map((entry) => <li key={entry.id}><div><strong>{status(entry.kind)}</strong><p>{entry.note}</p><small>{formatDate(entry.created_at)}</small></div><div className="ledger-amount"><strong>{money(Math.abs(entry.amount_paise))}</strong><small>{a(entry.amount_paise >= 0 ? 'Debit / dues increase' : 'Receipt / credit')}</small></div></li>)}</ul>}
      <p className="small muted">{a('Your balance is calculated by the server using the full ledger, not the visible page.')}</p>
      {ledgerError && <p role="alert" className="form-error">{accountFeedback(ledgerError, locale)}</p>}
      <div className="pagination"><button type="button" className="button secondary" disabled={ledgerBusy || !online || (ledgerPage?.offset ?? 0) === 0} onClick={() => void pageLedger(Math.max(0, (ledgerPage?.offset ?? 0) - 20))}>{t("Previous entries")}</button><button type="button" className="button secondary" disabled={ledgerBusy || !online || Boolean(ledgerPage && ledgerPage.offset + ledgerPage.items.length >= ledgerPage.total)} onClick={() => void pageLedger(ledgerPage ? ledgerPage.offset + 20 : 0)}>{t(ledgerPage ? 'Next entries' : 'Browse full ledger')}</button>{ledgerBusy && <span role="status">{a('Loading entries…')}</span>}</div>
    </section>
    <section className="customer-panel" aria-labelledby="delete-title"><h2 id="delete-title">{t("Account deletion")}</h2><p>{a('You can request deletion here or use the contact route on our')} <a href="/account-deletion/">{a('account deletion page')}</a> {a('for assistance.')} {a('The shop will explain any records it must retain for legitimate accounting or legal obligations.')}</p>
      {(workspace.deletion_requests?.length ?? 0) > 0 && <ul className="record-list">{workspace.deletion_requests!.map((request) => <li key={request.id}><span>{status(request.status)}<br /><small>{formatDate(request.created_at)}</small>{request.note && <p>{request.note}</p>}</span></li>)}</ul>}
      {!pendingDeletion && <form className="stack-form" onSubmit={(event) => { event.preventDefault(); if (!deleteConsent) return; void performAccount('Requesting account deletion', async () => { await command('request_account_deletion', { reason: deleteReason.trim() }); setDeleteConsent(false); }, 'Your deletion request is saved for processing. It is not a confirmation that deletion is complete.'); }}><label>{t("Reason")} <span className="muted">{t("Optional")}</span><textarea value={deleteReason} onChange={(event) => setDeleteReason(event.currentTarget.value)} maxLength={500} rows={2} disabled={busy} /></label><label className="check-label"><input type="checkbox" checked={deleteConsent} onChange={(event) => setDeleteConsent(event.currentTarget.checked)} required disabled={busy} /><span>{a('I want the shop to process an account deletion request.')}</span></label><button type="submit" className="button danger" disabled={busy || !online || !deleteConsent}>{t("Request deletion")}</button></form>}
    </section>
  </div>;
}
