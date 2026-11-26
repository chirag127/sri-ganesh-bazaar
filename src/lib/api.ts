import { createAuthClient } from '@neon/auth';
import { SupabaseAuthAdapter } from '@neon/auth/vanilla/adapters';
export type Session = NonNullable<Awaited<ReturnType<ReturnType<typeof makeAuth>['getSession']>>['data']['session']>;
function makeAuth(url: string) { return createAuthClient(url, { adapter: SupabaseAuthAdapter() }); }
import { createCommandQueue } from './commands';
import { validatePublicBackendSettings } from './public-config';
import { EVIDENCE_BUCKET, EVIDENCE_PATH, MAX_EVIDENCE_BYTES, UUID_PATTERN, evidenceFormat } from './evidence';
import type {
  AdminWorkspace, CatalogSnapshot, CommandName, CommandResult, CustomerDetail, Order, OrderDetail,
  Page, Product, Workspace,
} from './types';

const serviceUrl = import.meta.env.PUBLIC_COMMERCE_API_URL?.trim() ?? '';
const authUrl = import.meta.env.PUBLIC_NEON_AUTH_URL?.trim() ?? '';
export const isConfigured = Boolean(serviceUrl && authUrl);
let client: { auth: ReturnType<typeof makeAuth> } | undefined;

export function getClient() {
  if (!isConfigured) throw new Error('The shop is not connected yet. Browsing is available; ordering will open after setup.');
  if (!client) {
    const settings = validatePublicBackendSettings(serviceUrl, authUrl);
    client = { auth: makeAuth(settings.authUrl) };
  }
  return client;
}

function failure(error: unknown): Error {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  if (/fetch|network|load failed|timeout|connection/i.test(message)) {
    return new Error('Connection interrupted. Check order history before retrying; no offline change has been confirmed.');
  }
  return new Error(message.slice(0, 400) || 'The request could not be completed. Please try again.');
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  return request<T>(`/rpc/${encodeURIComponent(name)}`, args);
}

export async function request<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const settings = validatePublicBackendSettings(serviceUrl, authUrl);
  if (!token) {
    const result = await getClient().auth.getSession();
    if (result.error) throw failure(result.error);
    token = result.data.session?.access_token;
  }
  if (!token) throw new Error('Sign in with Google before accessing private records.');
  const response = await fetch(settings.url + path, {
    method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) throw new Error(`The shop request failed (${response.status}). Check history before retrying.`);
  return await response.json() as T;
}

export function subscribeAuth(callback: (session: Session | null) => void): () => void {
  let active = true;
  if (!isConfigured) {
    queueMicrotask(() => { if (active) callback(null); });
    return () => { active = false; };
  }
  const { data } = getClient().auth.onAuthStateChange((_event, session) => {
    // Do not call another async auth method inside Supabase's locked auth callback.
    queueMicrotask(() => { if (active) callback(session); });
  });
  return () => { active = false; data.subscription.unsubscribe(); };
}

const queue = createCommandQueue(async (name, payload, subject) => {
  const connection = getClient();
  const sessionResult = await connection.auth.getSession();
  if (sessionResult.error) throw failure(sessionResult.error);
  const session = sessionResult.data.session;
  if (!session || session.user.id !== subject) throw new Error('Your account changed. Review the form before submitting again.');
  // Bind this write to the initiating account even if another tab changes auth before fetch.
  return request<CommandResult>('/rpc/commerce_command', {
    p_action: name, p_payload: payload,
  }, session.access_token);
});
let commandSubject: string | null = null;

export async function command(name: CommandName, payload: Record<string, unknown> = {}): Promise<CommandResult> {
  const { data, error } = await getClient().auth.getSession();
  if (error) throw failure(error);
  const subject = data.session?.user.id;
  if (!subject) throw new Error('Sign in with Google before making changes.');
  if (commandSubject !== subject) { queue.clear(); commandSubject = subject; }
  return queue.run(subject, name, payload);
}

export function getWorkspace(): Promise<Workspace> { return rpc('customer_workspace'); }
export function getAdminWorkspace(): Promise<AdminWorkspace> { return rpc('admin_workspace'); }

export async function getCommercePage<T>(entity: string, query = '', offset = 0, limit = 50): Promise<Page<T>> {
  if (!['orders', 'customers', 'ledger', 'bills', 'submissions'].includes(entity)) throw new Error('Unknown record type.');
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Invalid page size.');
  }
  return rpc('commerce_page', { p_entity: entity, p_search: query.trim().slice(0, 100), p_limit: limit, p_offset: offset });
}
export function getCustomerOrders(offset = 0, limit = 20): Promise<Page<Order>> {
  return rpc('customer_orders', { p_offset: offset, p_limit: limit });
}
export function getCustomerOrderDetail(id: string): Promise<OrderDetail> {
  return rpc('customer_order_detail', { p_order_id: id });
}
export function getAdminOrderDetail(id: string): Promise<OrderDetail> {
  return rpc('admin_order_detail', { p_order_id: id });
}
export function getAdminCustomerDetail(id: string): Promise<CustomerDetail> {
  return rpc('admin_customer_detail', { p_customer_id: id });
}

function catalogSnapshot(value: unknown): CatalogSnapshot {
  if (!value || typeof value !== 'object' || !('products' in value) || !Array.isArray(value.products)) {
    throw new Error('The public catalog could not be read.');
  }
  const products: Product[] = value.products.filter((item) => item?.active === true).map((item) => {
    if (typeof item.id !== 'string' || typeof item.name !== 'string' || !Array.isArray(item.variants)) {
      throw new Error('A catalog product is incomplete.');
    }
    return {
      id: item.id, slug: String(item.slug), name: item.name, category: String(item.category),
      description: String(item.description ?? ''), image_url: typeof item.image_url === 'string' ? item.image_url : null,
      active: true,
      variants: item.variants.map((variant: Record<string, unknown>) => {
        if (typeof variant.id !== 'string' || (variant.weight_kg !== null && (!Number.isFinite(variant.weight_kg) || Number(variant.weight_kg) <= 0 || Number(variant.weight_kg) > 10000)) || (variant.unit_kind !== undefined && !['bag','jar','bottle','piece','pack'].includes(String(variant.unit_kind)))) {
          throw new Error('A catalog package is incomplete.');
        }
        return {
          id: variant.id, product_id: item.id, label: String(variant.label), weight_kg: variant.weight_kg === null ? null : Number(variant.weight_kg),
          unit_kind: (variant.unit_kind ?? 'bag') as NonNullable<Product['variants'][number]['unit_kind']>,
          available: variant.available === true,
        };
      }),
    };
  });
  return {
    products, configured: 'configured' in value && value.configured === true,
    generated_at: 'generated_at' in value && typeof value.generated_at === 'string' ? value.generated_at : undefined,
  };
}

export async function getCatalog(): Promise<CatalogSnapshot> {
  if (isConfigured) {
    try {
      const response = await fetch(validatePublicBackendSettings(serviceUrl, authUrl).url + '/catalog', { credentials: 'omit', cache: 'no-store', redirect: 'error' });
      if (!response.ok) throw new Error('Catalog request failed.');
      return { ...catalogSnapshot(await response.json()), stale: false };
    }
    catch { /* The last public snapshot is a browsing fallback, never confirmation of availability. */ }
  }
  const response = await fetch('/catalog.json', { credentials: 'omit', cache: 'no-cache' });
  if (!response.ok) throw new Error('The catalog is temporarily unavailable. Please contact the shop.');
  return { ...catalogSnapshot(await response.json()), stale: isConfigured };
}

export async function uploadPaymentEvidence(orderId: string, file: File): Promise<string> {
  if (!UUID_PATTERN.test(orderId)) throw new Error('Choose a valid order before uploading a screenshot.');
  if (file.size < 1 || file.size > MAX_EVIDENCE_BYTES) throw new Error('Payment screenshots must be between 1 byte and 2 MiB.');
  const format = evidenceFormat(new Uint8Array(await file.arrayBuffer()));
  const { data, error } = await getClient().auth.getSession();
  if (error) throw failure(error);
  const subject = data.session?.user.id;
  if (!subject) throw new Error('Sign in before uploading a screenshot.');
  const response = await fetch(validatePublicBackendSettings(serviceUrl, authUrl).url + `/evidence/upload?order_id=${encodeURIComponent(orderId)}`, {
    method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
    headers: { Authorization: `Bearer ${data.session!.access_token}`, 'Content-Type': format.mime }, body: file,
  });
  if (!response.ok) throw new Error('Screenshot upload failed.');
  const result = await response.json();
  if (typeof result.path !== 'string' || !EVIDENCE_PATH.test(result.path)) throw new Error('Invalid screenshot response.');
  return result.path;
}

export async function getPaymentEvidenceUrl(path: string): Promise<string> {
  if (!EVIDENCE_PATH.test(path)) throw new Error('The screenshot reference is invalid.');
  const data = await request<{url:string}>('/evidence/url', {path});
  const url = new URL(data.url);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid screenshot URL.');
  return url.href;
}
