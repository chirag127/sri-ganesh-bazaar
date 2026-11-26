import { getSiteOrigin, getStorefrontCatalog, getPublicPaths } from '../data/catalog';
export async function GET() {
  const catalog = await getStorefrontCatalog();
  const origin = getSiteOrigin(import.meta.env.PUBLIC_SITE_URL);
  const paths = catalog.configured ? getPublicPaths(catalog.products) : [];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${origin}${path}</loc></url>`).join('')}</urlset>`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
