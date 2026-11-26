import { boundedJson, E164, HttpError, record, timedFetch, UUID, type Fetcher } from './http.ts';

const GOOGLE_JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const MAX_FRESHNESS_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 30;

export interface PhoneChallenge {
  id: string;
  user_id: string;
  phone: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

export function validChallenge(value: unknown, subject: string, nowMs: number): PhoneChallenge {
  const item = record(value);
  const created = typeof item.created_at === 'string' ? Date.parse(item.created_at) : NaN;
  const expires = typeof item.expires_at === 'string' ? Date.parse(item.expires_at) : NaN;
  if (typeof item.id !== 'string' || !UUID.test(item.id) || item.user_id !== subject
    || typeof item.phone !== 'string' || !E164.test(item.phone) || item.consumed_at !== null
    || !Number.isFinite(created) || !Number.isFinite(expires) || expires <= nowMs || created > nowMs + 30_000
    || expires <= created || expires - created > 600_000 || nowMs - created > 600_000) {
    throw new HttpError(409, 'phone_challenge_expired_or_changed');
  }
  return item as unknown as PhoneChallenge;
}

export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new HttpError(401, 'invalid_phone_proof');
  try {
    const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
    return bytes;
  } catch { throw new HttpError(401, 'invalid_phone_proof'); }
}

export function encodeBase64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jwtObject(part: string): Record<string, unknown> {
  try { return record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64Url(part)))); }
  catch { throw new HttpError(401, 'invalid_phone_proof'); }
}

type SigningJwk = JsonWebKey & { kid: string };

export class FirebaseProofVerifier {
  private keys: SigningJwk[] = [];
  private expiresAt = 0;
  private lastRefresh = -Infinity;
  private refreshing?: Promise<void>;

  constructor(private readonly fetcher: Fetcher = fetch, private readonly now: () => number = Date.now) {}

  private async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    // Unknown key IDs must not turn arbitrary JWTs into an unbounded Google request loop.
    if (this.now() - this.lastRefresh < 30_000) throw new HttpError(503, 'phone_verification_temporarily_unavailable');
    this.lastRefresh = this.now();
    this.refreshing = (async () => {
      const response = await timedFetch(this.fetcher, GOOGLE_JWKS, { method: 'GET' });
      if (!response.ok) throw new HttpError(503, 'phone_verification_temporarily_unavailable');
      const body = record(await boundedJson(response, 65_536));
      if (!Array.isArray(body.keys) || body.keys.length === 0 || body.keys.length > 10) throw new HttpError(503, 'invalid_signing_keys');
      const keys = body.keys.filter((key): key is SigningJwk => key && typeof key === 'object'
        && key.kty === 'RSA' && key.alg === 'RS256' && key.use === 'sig'
        && typeof key.kid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(key.kid)
        && typeof key.n === 'string' && key.n.length >= 342 && typeof key.e === 'string' && !key.d);
      if (!keys.length) throw new HttpError(503, 'invalid_signing_keys');
      const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(response.headers.get('cache-control') ?? '');
      const seconds = maxAge ? Math.min(Number(maxAge[1]), 3600) : 60;
      this.keys = keys;
      this.expiresAt = this.now() + Math.max(0, seconds) * 1000;
    })();
    try { await this.refreshing; } finally { this.refreshing = undefined; }
  }

  async verify(token: unknown, projectId: string, challenge: PhoneChallenge): Promise<{ uid: string; phone: string }> {
    if (typeof token !== 'string' || token.length > 8192 || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) throw new HttpError(401, 'invalid_phone_proof');
    const parts = token.split('.');
    if (parts.length !== 3) throw new HttpError(401, 'invalid_phone_proof');
    const header = jwtObject(parts[0]);
    if (header.alg !== 'RS256' || (header.typ !== undefined && header.typ !== 'JWT') || header.crit !== undefined
      || header.b64 !== undefined || typeof header.kid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid)) throw new HttpError(401, 'invalid_phone_proof');
    if (this.now() >= this.expiresAt || !this.keys.some((key) => key.kid === header.kid)) await this.refresh();
    const jwk = this.keys.find((key) => key.kid === header.kid);
    if (!jwk || this.now() >= this.expiresAt) throw new HttpError(401, 'invalid_phone_proof');
    let verified = false;
    try {
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodeBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    } catch { throw new HttpError(401, 'invalid_phone_proof'); }
    if (!verified) throw new HttpError(401, 'invalid_phone_proof');
    // Claims become evidence only after verification against Google's fixed JWKS URL.
    const claims = jwtObject(parts[1]);
    const now = Math.floor(this.now() / 1000);
    const created = Math.floor(Date.parse(challenge.created_at) / 1000);
    const exp = claims.exp, iat = claims.iat, authTime = claims.auth_time;
    const firebase = record(claims.firebase);
    if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`
      || typeof claims.sub !== 'string' || claims.sub.length < 1 || claims.sub.length > 128
      || claims.phone_number !== challenge.phone || firebase.sign_in_provider !== 'phone'
      || typeof exp !== 'number' || !Number.isSafeInteger(exp) || exp <= now
      || typeof iat !== 'number' || !Number.isSafeInteger(iat) || iat > now + CLOCK_SKEW_SECONDS
      || typeof authTime !== 'number' || !Number.isSafeInteger(authTime) || authTime > now + CLOCK_SKEW_SECONDS
      || exp <= iat || exp - iat > 3900 || authTime > iat + CLOCK_SKEW_SECONDS
      || iat < created - CLOCK_SKEW_SECONDS || authTime < created - CLOCK_SKEW_SECONDS
      || now - iat > MAX_FRESHNESS_SECONDS || now - authTime > MAX_FRESHNESS_SECONDS
      || Date.parse(challenge.expires_at) <= this.now() || challenge.consumed_at !== null) throw new HttpError(401, 'invalid_phone_proof');
    return { uid: claims.sub, phone: challenge.phone };
  }
}
