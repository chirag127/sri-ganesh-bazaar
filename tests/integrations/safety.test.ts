import { describe, it, expect } from 'vitest';
import { allowedOrigins, corsHeaders, secretMatches } from '../../supabase/functions/_shared/http';
import { validChallenge, FirebaseProofVerifier } from '../../supabase/functions/_shared/firebase-proof';
import { outcome, createNotificationHandler } from '../../supabase/functions/send-notifications/handler';
import { createPhoneHandler } from '../../supabase/functions/phone-verification/handler';

describe('integration safety boundaries', () => {
  it('rejects wildcard, paths, insecure and deceptive origins', () => {
    for (const origin of ['*', 'https://example.test/path', 'http://example.test', 'https://example.test@evil.test']) expect(() => allowedOrigins(origin)).toThrow();
    const origins = allowedOrigins('https://example.test,https://localhost');
    expect(() => corsHeaders(new Request('https://edge.test', { headers: { origin: 'https://example.test.evil.test' } }), origins)).toThrow();
    expect(corsHeaders(new Request('https://edge.test', { headers: { origin: 'https://localhost' } }), origins).get('access-control-allow-origin')).toBe('https://localhost');
  });
  it('requires a strong exact worker secret', async () => {
    expect(await secretMatches('a'.repeat(32), 'a'.repeat(32))).toBe(true);
    expect(await secretMatches('b'.repeat(32), 'a'.repeat(32))).toBe(false);
    await expect(secretMatches('short', 'short')).rejects.toThrow();
  });
  it('binds phone challenges to current subject, time and single use', () => {
    const now = Date.now();
    const item = { id: '11111111-1111-4111-8111-111111111111', user_id: 'subject', phone: '+919876543210', created_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 60000).toISOString(), consumed_at: null };
    expect(validChallenge(item, 'subject', now).phone).toBe(item.phone);
    expect(() => validChallenge(item, 'other', now)).toThrow();
    expect(() => validChallenge({ ...item, consumed_at: new Date(now).toISOString() }, 'subject', now)).toThrow();
    expect(() => validChallenge(item, 'subject', now + 60001)).toThrow();
  });
  it('never treats unsigned JWTs as proof', async () => {
    const verifier = new FirebaseProofVerifier(() => { throw new Error('network must not run'); });
    await expect(verifier.verify('eyJhbGciOiJub25lIn0.e30.eA', 'project-test', {} as never)).rejects.toThrow();
  });
  it('does not infer successful delivery from ambiguous responses', () => {
    expect(outcome(201, 'provider-id')).toBe('sent');
    expect(outcome(201, undefined)).toBe('uncertain');
    expect(outcome(500, 'id')).toBe('uncertain');
    expect(outcome(408, null)).toBe('uncertain');
    expect(outcome(429, null)).toBe('failed');
  });
  it('disabled SMS cannot call providers or backend', async () => {
    const handler = createPhoneHandler(name => name === 'ALLOWED_ORIGINS' ? 'https://example.test' : undefined, () => { throw new Error('network must not run'); });
    const result = await handler(new Request('https://edge.test', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: '{}' }));
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: 'sms_disabled_use_staff_confirmation' });
  });
  it('worker rejects missing credentials before claiming jobs', async () => {
    const handler = createNotificationHandler(name => ({ ALLOWED_ORIGINS: 'https://example.test', NOTIFICATION_WORKER_SECRET: 'a'.repeat(32) }[name]), () => { throw new Error('network must not run'); });
    expect((await handler(new Request('https://edge.test', { method: 'POST' }))).status).toBe(401);
  });
});
