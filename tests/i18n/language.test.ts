import { describe, it, expect } from 'vitest';
import { language, translate, readLanguage, saveLanguage, LANGUAGE_KEY } from '../../src/lib/i18n';

describe('header language preferences', () => {
  it('defaults unsupported preferences to English', () => {
    for (const value of [null, undefined, '', 'fr', 'HI', {}, true]) expect(language(value)).toBe('en');
    expect(language('hi')).toBe('hi');
  });
  it('uses explicit translations and ignores unknown keys', () => {
    expect(translate('search', 'hi')).toBe('खोजें');
    expect(translate('search', 'en')).toBe('Search');
    expect(translate('customer supplied text', 'hi')).toBeUndefined();
    expect(translate('__proto__', 'hi')).toBeUndefined();
  });
  it('reads a valid preference without exposing storage failures', () => {
    expect(readLanguage({ getItem: key => key === LANGUAGE_KEY ? 'hi' : null })).toBe('hi');
    expect(readLanguage({ getItem: () => 'invalid' })).toBe('en');
    expect(readLanguage({ getItem: () => { throw Error('blocked'); } })).toBe('en');
  });
  it('reports blocked writes without preventing an in-memory selection', () => {
    let saved = '';
    expect(saveLanguage({ setItem: (key, value) => { saved = `${key}:${value}`; } }, 'hi')).toBe(true);
    expect(saved).toBe(`${LANGUAGE_KEY}:hi`);
    expect(saveLanguage({ setItem: () => { throw Error('blocked'); } }, 'en')).toBe(false);
  });
});
