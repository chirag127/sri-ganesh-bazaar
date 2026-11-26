import { describe, it, expect } from 'vitest';
import { androidTarget, androidServicesInput, assertAndroidIdentity } from '../../scripts/android-target.mjs';
const ids = { ANDROID_CUSTOMER_APP_ID: 'in.example.customer', ANDROID_ADMIN_APP_ID: 'in.example.admin' };
describe('Android target isolation', () => {
  it('preserves the legacy identity and directory by default', () => {
    expect(androidTarget({})).toMatchObject({appId:'in.oriz.sriganeshbazaar', path:'android', startPath:'/'});
    expect(androidTarget({ANDROID_APP_ID:'in.example.existing'}).appId).toBe('in.example.existing');
  });
  for (const target of ['customer', 'admin']) {
    it(`requires explicit ${target} identity`, () => expect(() => androidTarget({ANDROID_TARGET:target})).toThrow());
    it(`selects isolated ${target} directory and local entry`, () => {
      expect(androidTarget({...ids, ANDROID_TARGET:target})).toMatchObject({appId:ids[target === 'admin' ? 'ANDROID_ADMIN_APP_ID' : 'ANDROID_CUSTOMER_APP_ID'],path:`android-${target}`,startPath:target === 'admin' ? '/admin/' : '/app/'});
    });
  }
  it('rejects unknown targets and unsafe package identities', () => {
    expect(() => androidTarget({ANDROID_TARGET:'../admin'})).toThrow();
    expect(() => androidTarget({ANDROID_TARGET:'admin',ANDROID_ADMIN_APP_ID:'bad id'})).toThrow();
  });
  it('rejects collisions with legacy or other target', () => {
    expect(() => androidTarget({...ids,ANDROID_TARGET:'admin',ANDROID_ADMIN_APP_ID:ids.ANDROID_CUSTOMER_APP_ID})).toThrow();
    expect(() => androidTarget({ANDROID_TARGET:'admin',ANDROID_ADMIN_APP_ID:'in.oriz.sriganeshbazaar'})).toThrow();
  });
  it('never shares another target Firebase input implicitly', () => {
    const env={ANDROID_GOOGLE_SERVICES_JSON:'legacy',ANDROID_ADMIN_GOOGLE_SERVICES_JSON:'admin',ANDROID_CUSTOMER_GOOGLE_SERVICES_JSON:'customer'};
    expect(androidServicesInput(env,'admin')).toBe('admin');
    expect(androidServicesInput(env,'customer')).toBe('customer');
    expect(androidServicesInput({ANDROID_GOOGLE_SERVICES_JSON:'legacy'},'admin')).toBeUndefined();
  });
  it('accepts matching native identity', async () => {
    await expect(assertAndroidIdentity('/fixture',androidTarget({...ids,ANDROID_TARGET:'admin'}),async()=> 'defaultConfig { applicationId "in.example.admin" }')).resolves.toBeUndefined();
  });
  it('refuses repurposed or unverifiable native identities', async () => {
    for(const content of ['applicationId "in.example.other"','applicationId project.property("id")']) {
      await expect(assertAndroidIdentity('/fixture',androidTarget({...ids,ANDROID_TARGET:'admin'}),async()=>content)).rejects.toThrow();
    }
  });
  it('allows absent native project but propagates access errors', async () => {
    const target=androidTarget({...ids,ANDROID_TARGET:'admin'});
    await expect(assertAndroidIdentity('/fixture',target,async()=>{throw Object.assign(new Error(),{code:'ENOENT'});})).resolves.toBeUndefined();
    await expect(assertAndroidIdentity('/fixture',target,async()=>{throw Object.assign(new Error(),{code:'EACCES'});})).rejects.toThrow();
  });
});
