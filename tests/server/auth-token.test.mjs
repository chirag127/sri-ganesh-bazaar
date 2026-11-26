import { beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPair, SignJWT, UnsecuredJWT } from 'jose';
import { createTokenVerifier } from '../../server/auth-token.mjs';

const issuer = 'https://auth.example.test';
let keys;
let other;
beforeAll(async () => {
  keys = await generateKeyPair('EdDSA');
  other = await generateKeyPair('EdDSA');
});
function verifier(confirmed = true) {
  return createTokenVerifier({ key: keys.publicKey, issuer, googleOnlyConfirmed: () => confirmed });
}
async function signed(patch = {}, key = keys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: 'buyer', email: 'buyer@example.test', email_verified: true,
    provider: 'google', iss: issuer, iat: now, exp: now + 300, ...patch })
    .setProtectedHeader({ alg: 'EdDSA' }).sign(key);
}
describe('signed Neon identity verification', () => {
  it('accepts a valid EdDSA signature and verified identity', async () => {
    await expect(verifier()(await signed({ name: 'Buyer' }))).resolves.toEqual({
      subject: 'buyer', email: 'buyer@example.test', name: 'Buyer', email_verified: true,
    });
  });
  it('rejects the wrong issuer', async () => {
    await expect(verifier()(await signed({ iss: 'https://other.example.test' }))).rejects.toThrow();
  });
  it('rejects expired tokens', async () => {
    await expect(verifier()(await signed({ exp: Math.floor(Date.now() / 1000) - 60 }))).rejects.toThrow();
  });
  it('rejects signatures made with a different key', async () => {
    await expect(verifier()(await signed({}, other.privateKey))).rejects.toThrow();
  });
  it('rejects unsigned tokens', async () => {
    const token = new UnsecuredJWT({ sub: 'buyer', email: 'buyer@example.test', email_verified: true }).encode();
    await expect(verifier()(token)).rejects.toThrow();
  });
  for (const claim of ['sub', 'exp', 'iat', 'email', 'email_verified']) {
    it(`rejects a missing ${claim}`, async () => {
      await expect(verifier()(await signed({ [claim]: undefined }))).rejects.toThrow();
    });
  }
  it('rejects unverified email', async () => {
    await expect(verifier()(await signed({ email_verified: false }))).rejects.toThrow();
  });
  it('requires confirmed Google-only policy', async () => {
    await expect(verifier(false)(await signed())).rejects.toThrow('policy');
  });
  it('rejects an explicitly different provider', async () => {
    await expect(verifier()(await signed({ provider: 'github' }))).rejects.toThrow('Google required');
  });
  it('retains policy-gated compatibility when provider is absent', async () => {
    await expect(verifier()(await signed({ provider: undefined }))).resolves.toMatchObject({ subject: 'buyer' });
  });
});
