import { getSiteOrigin, getStorefrontCatalog } from '../data/catalog';
export async function GET() {
  const catalog = await getStorefrontCatalog();
  const origin = getSiteOrigin(import.meta.env.PUBLIC_SITE_URL);
  return new Response(catalog.configured ? `User-agent: *\nDisallow: /app/\nDisallow: /admin/\nSitemap: ${origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
