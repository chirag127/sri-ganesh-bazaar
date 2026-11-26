import { describe, it, expect, vi } from 'vitest';
import { rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { verifyUploadKey, verifySignedBundle } from '../../scripts/build-android.mjs';
// Public trust-store certificates are fixtures only; no private key is accessed.
const certificate = rootCertificates[0];
const env = { ANDROID_KEY_ALIAS: 'upload', ANDROID_KEYSTORE_PATH: '/fixture/upload.jks', ANDROID_KEYSTORE_PASSWORD: 'fixture-password', ANDROID_UPLOAD_CERT_SHA256: new X509Certificate(certificate).fingerprint256 };
const success = stdout => ({ status: 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) });
describe('upload certificate and bundle verification', () => {
  it('compares the exported certificate and keeps passwords out of argv', () => {
    const run = vi.fn(() => success(certificate));
    expect(() => verifyUploadKey(env, run)).not.toThrow();
    expect(run.mock.calls[0][1]).toContain('-storepass:env');
    expect(run.mock.calls[0][1]).not.toContain(env.ANDROID_KEYSTORE_PASSWORD);
    expect(run.mock.calls[0][2].stdio[0]).toBe('ignore');
  });
  it('rejects a different upload certificate', () => {
    expect(() => verifyUploadKey({...env, ANDROID_UPLOAD_CERT_SHA256: '00'.repeat(32)}, () => success(certificate))).toThrow('does not match');
  });
  for (const result of [{status:1,stderr:'private diagnostic'}, {status:null,error:new Error('private diagnostic')}, success('not a certificate')]) {
    it('fails closed and sanitizes certificate inspection failures', () => {
      expect(() => verifyUploadKey(env, () => result)).toThrow();
      try { verifyUploadKey(env, () => result); } catch (error) { expect(error.message).not.toContain('private diagnostic'); }
    });
  }
  it('requires strict signature verification and matching bundle certificate', () => {
    const run = vi.fn().mockReturnValueOnce(success(certificate)).mockReturnValueOnce(success('verified')).mockReturnValueOnce(success(certificate));
    expect(() => verifySignedBundle(env, '/fixture/app.aab', run)).not.toThrow();
    expect(run.mock.calls[1][1]).toContain('-strict');
    expect(run.mock.calls[1][1]).not.toContain(env.ANDROID_KEYSTORE_PASSWORD);
  });
  it('rejects jarsigner failure before reading signer metadata', () => {
    const run = vi.fn().mockReturnValueOnce(success(certificate)).mockReturnValueOnce({status:1,stderr:'private diagnostic'});
    expect(() => verifySignedBundle(env, '/fixture/app.aab', run)).toThrow('signature verification failed');
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('rejects unsigned output even if jarsigner exits zero', () => {
    const run = vi.fn().mockReturnValueOnce(success(certificate)).mockReturnValueOnce(success('unsigned')).mockReturnValueOnce(success(''));
    expect(() => verifySignedBundle(env, '/fixture/app.aab', run)).toThrow('Bundle signer');
  });
  it('rejects a bundle signed with another certificate', () => {
    const run = vi.fn().mockReturnValueOnce(success(certificate)).mockReturnValueOnce(success('verified')).mockReturnValueOnce(success(rootCertificates[1]));
    expect(() => verifySignedBundle(env, '/fixture/app.aab', run)).toThrow('Bundle signer');
  });
});
