import type { CatalogSnapshot, Product } from '../lib/types';

/** Proposed bags only: zero is an illustrative price placeholder, not a free offer. */
function proposedFeed(id: string, slug: string, name: string, details: string, category = 'Cattle feed'): Product {
  const productId = `example-${id}`;
  return {
    id: productId, slug, name, category,
    description: `Illustrative proposed assortment, not confirmed shop stock. ${details} Bag sizes are examples; confirm identity, grade, packaging and price with the shop before ordering.`,
    image_url: null, active: true,
    variants: [25, 50].map(weight => ({
      id: `${productId}-${weight}`, product_id: productId, label: `${weight} kg bag`,
      weight_kg: weight, available: false,
    })),
  };
}

/** Illustrations and example prices, never an assertion about the shop's stock. */
export const sampleCatalog: Product[] = [
  {
    id: 'example-cattle-feed', slug: 'cattle-feed', name: 'Compounded cattle feed / मिश्रित पशु आहार', category: 'Cattle feed',
    description: 'An illustrative compounded cattle-feed listing (mishrit pashu aahar, dana). The actual feed composition, suitability, manufacturer and package details must be confirmed by the shop before purchase.',
    image_url: null, active: true,
    variants: [
      { id: 'example-feed-25', product_id: 'example-cattle-feed', label: '25 kg bag', weight_kg: 25, available: false },
      { id: 'example-feed-50', product_id: 'example-cattle-feed', label: '50 kg bag', weight_kg: 50, available: false },
    ],
  },
  {
    id: 'example-wheat', slug: 'whole-wheat', name: 'Whole wheat / गेहूँ', category: 'Wheat',
    description: 'An illustrative whole-wheat listing (gehu, gehun, gay hun) sold by the complete bag. Ask the shop to confirm the variety, grade and package size in your quote.',
    image_url: null, active: true,
    variants: [
      { id: 'example-wheat-25', product_id: 'example-wheat', label: '25 kg bag', weight_kg: 25, available: false },
      { id: 'example-wheat-50', product_id: 'example-wheat', label: '50 kg bag', weight_kg: 50, available: false },
    ],
  },
  {
    id: 'example-rice', slug: 'rice-bag', name: 'Rice / चावल', category: 'Grains',
    description: 'An illustrative rice listing (chawal) for whole-bag enquiries. Variety, milling, quality and current reference price will be supplied by the shop for the real catalog.',
    image_url: null, active: true,
    variants: [
      { id: 'example-rice-25', product_id: 'example-rice', label: '25 kg bag', weight_kg: 25, available: false },
      { id: 'example-rice-50', product_id: 'example-rice', label: '50 kg bag', weight_kg: 50, available: false },
    ],
  },
  {
    id: 'example-millet', slug: 'pearl-millet', name: 'Pearl millet / बाजरा', category: 'Millet',
    description: 'An illustrative pearl-millet (bajra) listing in whole bags. Confirm the intended use, grade and current availability with the shop; loose quantities are not offered.',
    image_url: null, active: true,
    variants: [
      { id: 'example-millet-25', product_id: 'example-millet', label: '25 kg bag', weight_kg: 25, available: false },
      { id: 'example-millet-50', product_id: 'example-millet', label: '50 kg bag', weight_kg: 50, available: false },
    ],
  },
  {
    id: 'example-maize', slug: 'maize-bag', name: 'Maize / मक्का', category: 'Grains',
    description: 'An illustrative maize listing (makka, makai) for full-bag purchase enquiries. The shop must specify the product grade and intended use; this example makes no food or feed certification claim.',
    image_url: null, active: true,
    variants: [
      { id: 'example-maize-25', product_id: 'example-maize', label: '25 kg bag', weight_kg: 25, available: false },
      { id: 'example-maize-50', product_id: 'example-maize', label: '50 kg bag', weight_kg: 50, available: false },
    ],
  },
  {
    id: 'example-salt', slug: 'salt-bag', name: 'Salt / नमक', category: 'Salt',
    description: 'An illustrative bulk salt listing (namak), distinct from the proposed feed-grade salt. Ask the shop about the precise grade and intended use before accepting a quote. This example is not a product specification.',
    image_url: null, active: true,
    variants: [
      { id: 'example-salt-25', product_id: 'example-salt', label: '25 kg bag', weight_kg: 25, available: false },
      { id: 'example-salt-50', product_id: 'example-salt', label: '50 kg bag', weight_kg: 50, available: false },
    ],
  },
  proposedFeed('wheat-bran', 'wheat-bran', 'Wheat bran / गेहूँ का चोकर', 'Also called choker, chokar or gehun ka choker.'),
  proposedFeed('chickpea-husk', 'chickpea-husk', 'Chickpea husk / चने का छिलका', 'Chane ka chilka, chana chilka: chickpea husk. The word chilka alone is ambiguous; specify the grain or pulse.'),
  proposedFeed('chickpea-churi', 'chickpea-churi', 'Chickpea churi / चने की चूरी', 'Chane ki churi, chane ki chouri: a proposed chickpea milling by-product. Confirm the local product and milling composition.'),
  proposedFeed('broken-chickpea', 'broken-chickpea', 'Broken chickpea / चने का खंडा', 'Chana khanda, chane ka khanda: broken chickpea; confirm the local grade.'),
  proposedFeed('barley', 'barley', 'Barley / जौ', 'Whole barley grain: jau, jaw.', 'Grains'),
  proposedFeed('barley-meal', 'barley-meal', 'Barley meal / जौ का आटा', 'Ground barley: jau ka atta, jaw ka atta. Specify the required grind in your enquiry.', 'Grains'),
  proposedFeed('rice-bran', 'rice-bran', 'Rice bran / चावल की भूसी', 'Rice bran, chawal ki bhusi: confirm the milling fraction; not rice husk. Separate from de-oiled rice bran.'),
  proposedFeed('de-oiled-rice-bran', 'de-oiled-rice-bran', 'De-oiled rice bran / तेल रहित राइस ब्रान', 'DORB, de-oiled rice bran, tel rahit rice bran: distinct from ordinary rice bran.'),
  proposedFeed('mustard-cake', 'mustard-oil-cake', 'Mustard oil cake / सरसों की खली', 'Sarson ki khal, sarson ki khali: mustard oil cake. Confirm composition and processing.'),
  proposedFeed('cottonseed-cake', 'cottonseed-cake', 'Cottonseed cake / बिनौले की खली', 'Binaula khal, binola ki khal: cottonseed cake. Confirm identity and processing with the shop.'),
  proposedFeed('soybean-meal', 'soybean-meal', 'Soybean meal / सोयाबीन मील', 'Soyabean meal, soybean khal: confirm the actual processed product and specification.'),
  proposedFeed('groundnut-cake', 'groundnut-cake', 'Groundnut cake / मूँगफली की खली', 'Moongfali ki khal, mungfali khali: groundnut oil cake.'),
  proposedFeed('feed-salt', 'feed-grade-salt', 'Feed-grade salt / पशु आहार हेतु नमक', 'Pashu aahar namak: proposed feed-grade salt in whole bags, not a claim about the grade of the separate bulk salt listing.', 'Salt'),
  proposedFeed('mineral-mixture', 'feed-mineral-mixture', 'Feed mineral mixture / पशु खनिज मिश्रण', 'Pashu khanij mishran, mineral mixture: proposed bulk bags only. Confirm manufacturer instructions, species suitability and package size; no dosage or nutrient specification is implied.'),
];

export interface PublicBuildEnvironment {
  PUBLIC_SITE_URL?: string;
  PUBLIC_COMMERCE_API_URL?: string;
  PUBLIC_SHOP_PHONE?: string;
  PUBLIC_SHOP_ADDRESS?: string;
  PUBLIC_SHOP_HOURS?: string;
}

const MAX_PRODUCTS = 50;
const MAX_SNAPSHOT_BYTES = 512_000;
const INVALID_SNAPSHOT = 'The public catalog snapshot is invalid. Check published product fields before rebuilding.';
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(INVALID_SNAPSHOT);
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Error(INVALID_SNAPSHOT);
  }
  const result = value.trim();
  if (!empty && !result) throw new Error(INVALID_SNAPSHOT);
  return result;
}

function identifier(value: unknown): string {
  const result = text(value, 100);
  if (!ID.test(result)) throw new Error(INVALID_SNAPSHOT);
  return result;
}

export function categorySlug(category: string): string {
  const slug = category.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug || slug.length > 100) throw new Error(INVALID_SNAPSHOT);
  return slug;
}

/** Never embed signed/private storage URLs, credentials, or URL query parameters. */
export function publicImageUrl(value: unknown, catalogOrigin?: string): string | null {
  if (typeof value !== 'string' || value.length > 1_024) return null;
  if (/^\/images\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:avif|webp|png|jpe?g|svg)$/.test(value)) return value;
  if (!catalogOrigin) return null;
  try {
    const url = new URL(value);
    const backend = new URL(catalogOrigin);
    if (url.protocol !== 'https:' || url.origin !== backend.origin || url.username || url.password || url.search || url.hash) return null;
    return /^\/images\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:avif|webp|png|jpe?g)$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

/** Reconstruct every object from an allowlist: spreading RPC data would leak fields. */
export function validatePublicSnapshot(input: unknown, catalogOrigin?: string): CatalogSnapshot {
  const snapshot = record(input);
  if (snapshot.configured !== true || !Array.isArray(snapshot.products) || snapshot.products.length > MAX_PRODUCTS) {
    throw new Error(INVALID_SNAPSHOT);
  }
  const productIds = new Set<string>();
  const slugs = new Set<string>();
  const variantIds = new Set<string>();
  const categories = new Map<string, string>();
  const products: Product[] = snapshot.products.map((raw: unknown) => {
    const product = record(raw);
    const id = identifier(product.id);
    const slug = text(product.slug, 100);
    const category = text(product.category, 80);
    const categoryPath = categorySlug(category);
    if (!SLUG.test(slug) || productIds.has(id) || slugs.has(slug) || product.active !== true
      || (categories.has(categoryPath) && categories.get(categoryPath) !== category)
      || !Array.isArray(product.variants) || !product.variants.length || product.variants.length > 20) {
      throw new Error(INVALID_SNAPSHOT);
    }
    productIds.add(id);
    slugs.add(slug);
    categories.set(categoryPath, category);
    const variants = product.variants.map((rawVariant: unknown) => {
      const variant = record(rawVariant);
      const variantId = identifier(variant.id);
      if (variantIds.has(variantId) || variant.product_id !== id
        || typeof variant.available !== 'boolean'
        || (variant.weight_kg !== null && (typeof variant.weight_kg !== 'number' || !Number.isFinite(variant.weight_kg)
        || variant.weight_kg <= 0 || variant.weight_kg > 10000))
        || (variant.unit_kind !== undefined && !['bag','jar','bottle','piece','pack'].includes(String(variant.unit_kind)))) {
        throw new Error(INVALID_SNAPSHOT);
      }
      variantIds.add(variantId);
      return {
        id: variantId, product_id: id, label: text(variant.label, 100),
        weight_kg: variant.weight_kg as number | null,
        unit_kind: (variant.unit_kind ?? 'bag') as NonNullable<Product['variants'][number]['unit_kind']>,
        available: variant.available,
      };
    });
    return {
      id, slug, name: text(product.name, 140), category,
      description: text(product.description, 4_000, true),
      image_url: publicImageUrl(product.image_url, catalogOrigin), active: true, variants,
    };
  });
  return { products, configured: true };
}

export function getSiteOrigin(input?: string): string {
  try {
    const url = new URL(input?.trim() || 'https://vikas.oriz.in');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    return url.origin;
  } catch { throw new Error('PUBLIC_SITE_URL must be a stable HTTPS origin without a path, credentials, query, or fragment.'); }
}

function publicBackend(input: string): string {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    return url.origin;
  } catch { throw new Error('PUBLIC_COMMERCE_API_URL must be an HTTPS API origin.'); }
}

export async function loadBuildCatalog(env: PublicBuildEnvironment, fetcher: typeof fetch = fetch): Promise<CatalogSnapshot> {
  const url = env.PUBLIC_COMMERCE_API_URL?.trim();
  if (!url) return { products: sampleCatalog, configured: false };
  const origin = publicBackend(url);
  let response: Response;
  try {
    response = await fetcher(`${origin}/catalog`, {
      method: 'GET', credentials: 'omit',
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('The configured public catalog could not be reached. The build stopped; no sample catalog was substituted.');
  }
  if (!response.ok) throw new Error('The configured public catalog request failed. Check anonymous catalog access before rebuilding.');
  if (Number(response.headers.get('content-length') || 0) > MAX_SNAPSHOT_BYTES) throw new Error(INVALID_SNAPSHOT);
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_SNAPSHOT_BYTES) throw new Error(INVALID_SNAPSHOT);
  let input: unknown;
  try { input = JSON.parse(body); } catch { throw new Error(INVALID_SNAPSHOT); }
  return validatePublicSnapshot(input, origin);
}

let buildCatalog: Promise<CatalogSnapshot> | undefined;
/** One anonymous read per build module; importing sampleCatalog never starts a request. */
export function getStorefrontCatalog(): Promise<CatalogSnapshot> {
  buildCatalog ??= loadBuildCatalog({
    PUBLIC_COMMERCE_API_URL: import.meta.env.PUBLIC_COMMERCE_API_URL,
  });
  return buildCatalog;
}

export function getCategories(products: Product[]): Array<{ name: string; slug: string; count: number }> {
  const result = new Map<string, { name: string; slug: string; count: number }>();
  for (const product of products) {
    const entry = result.get(product.category) ?? { name: product.category, slug: categorySlug(product.category), count: 0 };
    entry.count += 1;
    result.set(product.category, entry);
  }
  return [...result.values()];
}

export function getPublicPaths(products: Product[]): string[] {
  return ['/', '/products/', '/categories/', '/contact/', '/privacy/', '/terms/', '/account-deletion/',
    ...products.map((product) => `/products/${product.slug}/`),
    ...getCategories(products).map((category) => `/categories/${category.slug}/`)];
}

export function getShopDetails(env: PublicBuildEnvironment) {
  const phone = env.PUBLIC_SHOP_PHONE?.trim() ?? '';
  return {
    phone: /^\+?[\d ()-]{7,24}$/.test(phone) ? phone : '',
    phoneHref: /^\+?[\d ()-]{7,24}$/.test(phone) ? `tel:${phone.replace(/[^+\d]/g, '')}` : '',
    address: env.PUBLIC_SHOP_ADDRESS?.trim().slice(0, 600) ?? '',
    hours: env.PUBLIC_SHOP_HOURS?.trim().slice(0, 300) ?? '',
  };
}

export function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Capacitor's local asset server must receive an actual file, not an SPA fallback. */
export function staticPageHref(path: string): string {
  const match = /^(\/[^?#]*)([?#].*)?$/.exec(path);
  if (!match || path.startsWith('//')) return path;
  const [, pathname, suffix = ''] = match;
  return pathname.endsWith('/') ? `${pathname}index.html${suffix}` : path;
}
