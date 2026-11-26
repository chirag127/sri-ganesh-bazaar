import { boundedJson, HttpError, record, serverUrl, timedFetch, UUID, type Environment, type Fetcher } from './http.ts';

export class Backend {
  private readonly url: string;
  private readonly key: string;

  constructor(env: Environment, private readonly fetcher: Fetcher = fetch) {
    this.url = serverUrl(env('SUPABASE_URL'));
    this.key = env('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!this.key || this.key.length > 8192) throw new HttpError(503, 'backend_configuration_required');
  }

  async googleUser(token: string): Promise<string> {
    const response = await timedFetch(this.fetcher, `${this.url}/auth/v1/user`, {
      headers: { apikey: this.key, Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new HttpError(401, 'sign_in_required');
    const user = record(await boundedJson(response, 65_536));
    if (typeof user.id !== 'string' || !UUID.test(user.id) || !Array.isArray(user.identities)
      || !user.identities.some((identity) => identity && typeof identity === 'object' && identity.provider === 'google')) {
      throw new HttpError(403, 'google_account_required');
    }
    return user.id;
  }

  async rpc(name: 'phone_challenge' | 'phone_complete' | 'notification_claim' | 'notification_finish', args: Record<string, unknown>): Promise<unknown> {
    const response = await timedFetch(this.fetcher, `${this.url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!response.ok) throw new HttpError(response.status >= 500 ? 503 : 409, 'backend_request_not_completed');
    return boundedJson(response, 131_072);
  }
}
