import { jwtVerify } from 'jose';

/** Verify signatures before trusting identity; provider policy remains a deployment gate. */
export function createTokenVerifier({ key, issuer, googleOnlyConfirmed }) {
  return async token => {
    const { payload } = await jwtVerify(token, key, {
      issuer, algorithms: ['EdDSA', 'RS256', 'ES256'], requiredClaims: ['sub', 'exp', 'iat'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' || payload.email_verified !== true) throw new Error('Invalid identity');
    if (!googleOnlyConfirmed()) throw new Error('Google provider policy not confirmed');
    if (payload.provider && payload.provider !== 'google') throw new Error('Google required');
    return { subject: payload.sub, email: payload.email, name: typeof payload.name === 'string' ? payload.name.slice(0, 120) : '', email_verified: true };
  };
}
