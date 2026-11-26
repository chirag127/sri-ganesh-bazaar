import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ native: false, oauth: vi.fn(), logout: vi.fn(), unregister: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mocks.native } }));
vi.mock('../../src/lib/api', () => ({ getClient: () => ({ auth: { signInWithOAuth: mocks.oauth, signOut: mocks.logout } }) }));
vi.mock('../../src/lib/notifications', () => ({ unregisterPush: mocks.unregister, requestPush: vi.fn() }));
import { signInGoogle, signOut, requestSms, confirmSms } from '../../src/lib/auth';
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); mocks.native = false; });
describe('authentication safety', () => {
  it('does not launch OAuth inside a native WebView', async () => {
    mocks.native = true;
    await expect(signInGoogle()).rejects.toThrow('Native Google sign-in');
    expect(mocks.oauth).not.toHaveBeenCalled();
  });
  it('uses Google and the current web origin callback', async () => {
    vi.stubGlobal('location', { origin: 'https://shop.example' });
    mocks.oauth.mockResolvedValue({ error: null });
    await signInGoogle();
    expect(mocks.oauth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'https://shop.example/app/' } });
  });
  it.each(['/admin/', '/admin/index.html'])('returns staff sign-in to %s', async pathname => {
    vi.stubGlobal('location', { origin: 'https://shop.example', pathname });
    mocks.oauth.mockResolvedValue({ error: null });
    await signInGoogle();
    expect(mocks.oauth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'https://shop.example/admin/' } });
  });
  it('does not treat an admin-like path as an admin entry', async () => {
    vi.stubGlobal('location', { origin: 'https://shop.example', pathname: '/administrator/' });
    mocks.oauth.mockResolvedValue({ error: null });
    await signInGoogle();
    expect(mocks.oauth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'https://shop.example/app/' } });
  });
  it('does not expose provider diagnostics on login failure', async () => {
    vi.stubGlobal('location', { origin: 'https://shop.example' });
    mocks.oauth.mockResolvedValue({ error: { message: 'private-token' } });
    await expect(signInGoogle()).rejects.toThrow('Google sign-in could not be started');
  });
  it('unregisters notifications before ending the session', async () => {
    mocks.unregister.mockResolvedValue(undefined); mocks.logout.mockResolvedValue({ error: null });
    await signOut();
    expect(mocks.unregister.mock.invocationCallOrder[0]).toBeLessThan(mocks.logout.mock.invocationCallOrder[0]);
  });
  it('reports unsuccessful sign-out rather than claiming completion', async () => {
    mocks.unregister.mockResolvedValue(undefined); mocks.logout.mockResolvedValue({ error: {} });
    await expect(signOut()).rejects.toThrow('Sign-out could not be completed');
  });
  it('fails closed for unavailable SMS start and completion', async () => {
    await expect(requestSms('+919876543210')).rejects.toThrow('staff confirmation');
    await expect(confirmSms('123456')).rejects.toThrow('staff confirmation');
    expect(mocks.oauth).not.toHaveBeenCalled();
  });
});
