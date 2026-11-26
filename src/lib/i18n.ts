export type Language = 'en' | 'hi';
export const LANGUAGE_KEY = 'pashu-saathi.language';
export const LANGUAGE_EVENT = 'pashu-saathi:language-change';
const dictionary = {
  shop: ['Shop bags', 'बोरियाँ खरीदें'], categories: ['Categories', 'श्रेणियाँ'],
  order: ['How to order', 'ऑर्डर कैसे करें'], contact: ['Contact', 'संपर्क'],
  search: ['Search', 'खोजें'], searchLabel: ['Search feed and wholesale products', 'पशु आहार और थोक उत्पाद खोजें'],
  searchHint: ['Search choker, khal, cattle feed…', 'चोकर, खल, पशु आहार खोजें…'],
  account: ['My account', 'मेरा खाता'], cart: ['Bag list', 'खरीद सूची'],
  home: ['Pashu Saathi home', 'पशु साथी मुख्य पृष्ठ'],
  note: ['Cattle feed & wholesale essentials', 'पशु आहार और थोक सामग्री'],
  navigation: ['Main navigation', 'मुख्य नेविगेशन'],
  searchShop: ['Search shop', 'दुकान में खोजें'],
  tagline: ['Whole bags. Clear quotes. Personal service.', 'पूरी बोरियाँ। स्पष्ट कोटेशन। व्यक्तिगत सेवा।'],
} as const;
export type TranslationKey = keyof typeof dictionary;
export function language(value: unknown): Language { return value === 'hi' ? 'hi' : 'en'; }
export function translate(key: string, locale: Language): string | undefined {
  return Object.hasOwn(dictionary, key) ? dictionary[key as TranslationKey][locale === 'hi' ? 1 : 0] : undefined;
}
export function readLanguage(storage: Pick<Storage, 'getItem'>): Language {
  try { return language(storage.getItem(LANGUAGE_KEY)); } catch { return 'en'; }
}
export function saveLanguage(storage: Pick<Storage, 'setItem'>, locale: Language): boolean {
  try { storage.setItem(LANGUAGE_KEY, locale); return true; } catch { return false; }
}
/** Only opt-in static header nodes; never walk or translate application/customer content. */
export function applyHeaderLanguage(root: HTMLElement, locale: Language): void {
  for (const [attribute, target] of [['data-i18n', null], ['data-i18n-placeholder', 'placeholder'], ['data-i18n-label', 'aria-label']] as const) {
    root.querySelectorAll<HTMLElement>(`[${attribute}]`).forEach(node => {
      const text = translate(node.getAttribute(attribute) ?? '', locale);
      if (text === undefined) return;
      if (target) node.setAttribute(target, text); else node.textContent = text;
    });
  }
  root.lang = locale;
}
