import { describe, it, expect, vi } from 'vitest';
import { resolveAndroidServices } from '../../scripts/prepare-android.mjs';

const appId = 'in.oriz.pashusaathi';
const valid = (id = appId) => JSON.stringify({ project_info: { project_id: 'fixture' }, client: [{ client_info: { android_client_info: { package_name: id } } }] });
const missing = async () => { throw Object.assign(new Error('fixture'), { code: 'ENOENT' }); };

describe('Android services preservation', () => {
  it('uses existing valid configuration without rewriting it', async () => {
    const read = vi.fn(async () => valid());
    const result = await resolveAndroidServices('/fixture/google-services.json', appId, undefined, read);
    expect(result).toEqual({ services: JSON.parse(valid()), write: false });
    expect(read).toHaveBeenCalledOnce();
  });
  it('treats an empty explicit setting as preservation', async () => {
    expect((await resolveAndroidServices('/fixture', appId, '', async () => valid())).write).toBe(false);
  });
  it('leaves absent optional configuration absent', async () => {
    expect(await resolveAndroidServices('/fixture', appId, undefined, missing)).toEqual({ services: undefined, write: false });
  });
  it('validates an explicit configuration before requesting a write', async () => {
    expect(await resolveAndroidServices('/fixture', appId, valid(), missing)).toEqual({ services: JSON.parse(valid()), write: true });
  });
  it('permits explicit replacement of a valid existing configuration', async () => {
    expect((await resolveAndroidServices('/fixture', appId, valid(), async () => valid())).write).toBe(true);
  });
  for (const raw of ['not-json-private-sentinel', 'null', '[]', '{}', valid('wrong.package.id'), JSON.stringify({ client: {} })]) {
    it(`rejects invalid existing fixture ${raw.slice(0, 16)} even with replacement`, async () => {
      await expect(resolveAndroidServices('/fixture', appId, valid(), async () => raw)).rejects.toMatchObject({ code: 'FIREBASE_PACKAGE' });
    });
  }
  for (const secret of [{ private_key: 'private-sentinel' }, { private_key_id: 'private-sentinel' }, { client_email: 'private-sentinel' }, { type: 'service_account' }, { nested: { private_key: 'private-sentinel' } }]) {
    it('rejects service-account material without revealing it', async () => {
      const raw = JSON.stringify({ ...JSON.parse(valid()), ...secret });
      await expect(resolveAndroidServices('/fixture', appId, raw, missing)).rejects.toThrow('contain no service account');
      try { await resolveAndroidServices('/fixture', appId, raw, missing); } catch (error) { expect(error.message).not.toContain('private-sentinel'); }
    });
  }
  it('fails closed on read errors rather than treating them as absence', async () => {
    const read = async () => { throw Object.assign(new Error('private-sentinel'), { code: 'EACCES' }); };
    await expect(resolveAndroidServices('/fixture', appId, valid(), read)).rejects.toMatchObject({ code: 'FIREBASE_READ' });
  });
  it('rejects invalid explicit configuration despite a valid saved file', async () => {
    await expect(resolveAndroidServices('/fixture', appId, 'bad', async () => valid())).rejects.toMatchObject({ code: 'FIREBASE_PACKAGE' });
  });
});
