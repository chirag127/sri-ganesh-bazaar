import { getStorefrontCatalog } from '../data/catalog';
export async function GET() {
  return new Response(JSON.stringify(await getStorefrontCatalog()), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
