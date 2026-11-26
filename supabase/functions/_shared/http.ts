export type Environment = (name: string) => string | undefined;
export type Fetcher = typeof fetch;

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const E164 = /^\+[1-9]\d{7,14}$/;

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_request');
  return value as Record<string, unknown>;
}

export function allowedOrigins(raw: string | undefined): Set<string> {
  const origins = new Set<string>();
  if (!raw || raw.length > 4096) throw new HttpError(503, 'origin_configuration_required');
  for (const item of raw.split(',').map((part) => part.trim()).filter(Boolean)) {
    let url: URL;
    try { url = new URL(item); } catch { throw new HttpError(503, 'invalid_origin_configuration'); }
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((!localHttp && url.protocol !== 'https:') || item !== url.origin || url.username || url.password) {
      throw new HttpError(503, 'invalid_origin_configuration');
    }
    origins.add(item);
  }
  if (origins.size === 0 || origins.size > 32) throw new HttpError(503, 'invalid_origin_configuration');
  return origins;
}

export function corsHeaders(request: Request, origins: Set<string>, allowOriginless = false): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' });
  const origin = request.headers.get('origin');
  if (!origin) {
    if (!allowOriginless || request.method === 'OPTIONS') throw new HttpError(403, 'origin_not_allowed');
    return headers;
  }
  if (!origins.has(origin)) throw new HttpError(403, 'origin_not_allowed');
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info, x-worker-secret');
  headers.set('Access-Control-Max-Age', '300');
  return headers;
}

export function preflight(request: Request, headers: Headers): Response | undefined {
  if (request.method !== 'OPTIONS') return;
  const method = request.headers.get('access-control-request-method');
  const requestedHeaders = (request.headers.get('access-control-request-headers') ?? '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const permitted = new Set(['authorization', 'apikey', 'content-type', 'x-client-info', 'x-worker-secret']);
  if (method !== 'POST' || requestedHeaders.some((name) => !permitted.has(name))) throw new HttpError(403, 'preflight_not_allowed');
  return new Response(null, { status: 204, headers });
}

export function json(value: unknown, status = 200, headers?: Headers): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: headers ?? { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' },
  });
}

export function failure(error: unknown, headers?: Headers): Response {
  // SDK/HTTP messages can contain phones, tokens, or credentials.
  return json({ error: error instanceof HttpError ? error.code : 'request_failed' }, error instanceof HttpError ? error.status : 503, headers);
}

export async function boundedJson(response: Request | Response, limit = 16_384): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new HttpError(413, 'body_too_large');
  if (!response.body) throw new HttpError(400, 'invalid_json');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, 'body_too_large');
      }
      chunks.push(value);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'invalid_json');
  } finally { reader.releaseLock(); }
}

export async function requestBody(request: Request, limit = 12_288): Promise<Record<string, unknown>> {
  if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'json_required');
  return record(await boundedJson(request, limit));
}

export function bearer(request: Request): string {
  const match = /^Bearer ([A-Za-z0-9._~-]{20,8192})$/i.exec(request.headers.get('authorization') ?? '');
  if (!match) throw new HttpError(401, 'sign_in_required');
  return match[1];
}

export async function secretMatches(candidate: string | null, expected: string | undefined): Promise<boolean> {
  if (!expected || expected.length < 32 || expected.length > 512) throw new HttpError(503, 'worker_secret_required');
  if (!candidate || candidate.length > 512) return false;
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode.encode(candidate)),
    crypto.subtle.digest('SHA-256', encode.encode(expected)),
  ]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

export function serverUrl(value: string | undefined): string {
  if (!value) throw new HttpError(503, 'backend_configuration_required');
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpError(503, 'backend_configuration_required'); }
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', 'kong', 'host.docker.internal'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new HttpError(503, 'backend_configuration_required');
  return url.origin;
}

export function timedFetch(fetcher: Fetcher, input: string, init: RequestInit, timeoutMs = 8_000): Promise<Response> {
  return fetcher(input, { ...init, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
}
