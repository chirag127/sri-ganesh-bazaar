export interface PublicBackendSettings { url: string; authUrl: string; }
export function publicUrl(raw: string, allowPath = false): string {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error('Set a valid public Neon endpoint URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || (!allowPath && url.pathname !== '/')) throw new Error('Use an HTTPS endpoint without credentials, query parameters, or fragments.');
  return url.href.replace(/\/$/, '');
}
export function validatePublicBackendSettings(rawUrl: string, rawAuthUrl: string): PublicBackendSettings {
  return { url: publicUrl(rawUrl), authUrl: publicUrl(rawAuthUrl, true) };
}
