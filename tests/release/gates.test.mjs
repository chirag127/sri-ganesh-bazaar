import { describe, it, expect } from 'vitest';
import { assertReleaseContext, assertReleaseConfiguration, assertPublicContent, ATTESTATIONS } from '../../scripts/release-readiness.mjs';
const sha = 'a'.repeat(40);
function context() {
  const env = {GITHUB_ACTIONS:'true', GITHUB_EVENT_NAME:'workflow_dispatch', GITHUB_REF:'refs/heads/main', GITHUB_REF_PROTECTED:'true', RELEASE_ENVIRONMENT:'android-release', RELEASES_ENABLED:'true', RELEASE_ENVIRONMENT_CONFIGURED:'true', RELEASE_APPROVED:'true', GITHUB_SHA:sha, RELEASE_APPROVED_SHA:sha};
  for (const name of ATTESTATIONS) env[name] = 'true';
  return {env,event:{repository:{default_branch:'main'},inputs:{approve:'true',reviewed_sha:sha}}};
}
describe('release protection', () => {
  function configured() {
    return { ANDROID_APP_ID:'in.oriz.pashusaathi', PUBLIC_SITE_URL:'https://shop.test',
      PUBLIC_NEON_AUTH_URL:'https://auth.test', PUBLIC_COMMERCE_API_URL:'https://api.test',
      PUBLIC_SHOP_PHONE:'fixture-phone', PUBLIC_SHOP_ADDRESS:'fixture-address', PUBLIC_SHOP_HOURS:'fixture-hours',
      ANDROID_UPLOAD_CERT_SHA256:'A'.repeat(64), ANDROID_VERSION_CODE:'1', ANDROID_VERSION_NAME:'1.0.0',
      ANDROID_KEYSTORE_PATH:'/external/upload.jks', ANDROID_KEYSTORE_PASSWORD:'fixture-password',
      ANDROID_KEY_ALIAS:'upload', ANDROID_KEY_PASSWORD:'fixture-password' };
  }
  it('validates Neon signing configuration without Supabase or optional Firebase', () => {
    expect(() => assertReleaseConfiguration(configured(), 'signed')).not.toThrow();
  });
  for (const name of ['PUBLIC_NEON_AUTH_URL', 'PUBLIC_COMMERCE_API_URL']) {
    it(`requires ${name}`, () => expect(() => assertReleaseConfiguration({...configured(), [name]:''}, 'signed')).toThrow());
    it(`rejects insecure ${name}`, () => expect(() => assertReleaseConfiguration({...configured(), [name]:'http://api.test'}, 'signed')).toThrow());
  }
  it('rejects commerce and site paths but preserves managed Auth paths', () => {
    for (const key of ['PUBLIC_SITE_URL', 'PUBLIC_COMMERCE_API_URL']) {
      expect(() => assertReleaseConfiguration({...configured(), [key]:'https://shop.test/path'}, 'signed')).toThrow();
    }
    expect(() => assertReleaseConfiguration({...configured(), PUBLIC_NEON_AUTH_URL:'https://auth.test/db/auth'}, 'signed')).not.toThrow();
  });
  it('requires Firebase configuration when push is enabled', () => {
    expect(() => assertReleaseConfiguration({...configured(), PUBLIC_ENABLE_PUSH:'true'}, 'signed')).toThrow();
  });
  for (const name of ['COMMERCE_DATABASE_URL', 'DATABASE_URL', 'AWS_SECRET_ACCESS_KEY', 'TELEGRAM_BOT_TOKEN', 'SENTRY_AUTH_TOKEN']) {
    it(`rejects leaked ${name}`, () => expect(() => assertPublicContent('fixture-private-value', {[name]:'fixture-private-value'})).toThrow());
  }
  it('allows only matching approved context', () => { const {env,event}=context(); expect(()=>assertReleaseContext(env,event,sha)).not.toThrow(); });
  for(const patch of [{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_REF:'refs/pull/1/merge'},{GITHUB_REF_PROTECTED:'false'},{RELEASE_APPROVED_SHA:'b'.repeat(40)},{RELEASES_ENABLED:'false'},{RELEASE_DEVICE_TESTED:'false'}]) {
    it(`rejects ${Object.keys(patch)[0]}`,()=>{const {env,event}=context();expect(()=>assertReleaseContext({...env,...patch},event,sha)).toThrow();});
  }
  it('binds signing approval to the selected Android target', () => {
    const { env, event } = context();
    for (const target of ['customer', 'admin']) {
      expect(() => assertReleaseContext({ ...env, ANDROID_TARGET: target }, { ...event, inputs: { ...event.inputs, target } }, sha)).not.toThrow();
      expect(() => assertReleaseContext({ ...env, ANDROID_TARGET: target }, event, sha)).toThrow('target');
      expect(() => assertReleaseContext({ ...env, ANDROID_TARGET: target }, { ...event, inputs: { ...event.inputs, target: target === 'admin' ? 'customer' : 'admin' } }, sha)).toThrow('target');
    }
    expect(() => assertReleaseContext({ ...env, ANDROID_TARGET: 'unknown' }, event, sha)).toThrow('target');
  });
  it('unsigned mode needs no credentials',()=>expect(assertReleaseConfiguration({},'unsigned').appId).toBeTruthy());
  it('signed mode rejects absent credentials',()=>expect(()=>assertReleaseConfiguration({},'signed')).toThrow());
  it('rejects private keys without printing their value',()=>expect(()=>assertPublicContent('-----BEGIN PRIVATE KEY-----')).toThrow('Privileged credential'));
  it('rejects configured private values',()=>expect(()=>assertPublicContent('fixture-secret-value',{BREVO_API_KEY:'fixture-secret-value'})).toThrow());
  it('rejects service-role JWT',()=>{const token='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.signature';expect(()=>assertPublicContent(token)).toThrow();});
});
