import { useEffect, useState } from 'react';
import { LANGUAGE_EVENT, LANGUAGE_KEY, language, readLanguage, type Language } from './i18n';

/** The mounted selector retains the in-document choice even when storage is blocked. */
export function currentLanguage(): Language {
  if (typeof window === 'undefined') return 'en';
  const selected = document.querySelector<HTMLSelectElement>('[data-language-toggle]')?.value;
  if (selected === 'en' || selected === 'hi') return selected;
  const header = document.querySelector<HTMLElement>('.site-header')?.lang;
  if (header === 'en' || header === 'hi') return header;
  try { return readLanguage(window.localStorage); } catch { return 'en'; }
}

export function useLanguage(): Language {
  const [locale, setLocale] = useState<Language>('en');
  useEffect(() => {
    const read = () => setLocale(currentLanguage());
    read();
    const change = (event: Event) => setLocale(language((event as CustomEvent<{language?: unknown}>).detail?.language));
    const storage = (event: StorageEvent) => { if (event.key === LANGUAGE_KEY || event.key === null) read(); };
    window.addEventListener(LANGUAGE_EVENT, change);
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener(LANGUAGE_EVENT, change); window.removeEventListener('storage', storage); };
  }, []);
  return locale;
}
