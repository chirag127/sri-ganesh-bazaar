import { randomUUID } from 'node:crypto';
import { COUNT_FIELDS, aggregateCounts, createAggregateAnalysis } from './aggregate-analysis.mjs';

export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/i;
const RPC = Object.freeze({
 customer_workspace: [], admin_workspace: [],
 owner_analytics: ['p_from', 'p_to'],
 product_request_command: ['p_action', 'p_payload'],
 product_requests_page: ['p_admin', 'p_limit', 'p_offset'],
 cart_estimate: ['p_lines', 'p_fulfillment'],
 estimate_settings_command: ['p_action', 'p_payload'],
 commerce_command: ['p_action', 'p_payload'],
 commerce_page: ['p_entity', 'p_search', 'p_limit', 'p_offset'],
 customer_orders: ['p_offset', 'p_limit'],
 customer_order_detail: ['p_order_id'], admin_order_detail: ['p_order_id'],
 admin_customer_detail: ['p_customer_id'],
});
export async function boundedBody(request, maximum) {
 const declared = request.headers.get('content-length');
 if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new HttpError(413, 'Request too large');
 const reader = request.body?.getReader(); if (!reader) return new Uint8Array();
 const chunks = []; let size = 0;
 try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maximum) { await reader.cancel(); throw new HttpError(413, 'Request too large'); } chunks.push(value); } }
 finally { reader.releaseLock(); }
 const out = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; } return out;
}
export function imageType(bytes) {
 if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return ['png','image/png'];
 if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ['jpg','image/jpeg'];
 if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP') return ['webp','image/webp'];
 throw new HttpError(415, 'Only PNG, JPEG and WebP images are accepted');
}
export function createApi({ database, verifyToken, storage, origins = [], uuid = randomUUID, aggregateAnalysis = createAggregateAnalysis() }) {
 const allowed = new Set(origins);
 return { async fetch(request) {
  const origin = request.headers.get('origin');
  const headers = { 'Content-Type':'application/json', 'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff', Vary:'Origin' };
  const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers});
  if (origin && !allowed.has(origin)) return json({error:'Origin denied'},403);
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
  try {
   const url = new URL(request.url);
   if (request.method === 'GET' && url.pathname === '/health') return json({ok:true});
   if (request.method === 'GET' && url.pathname === '/catalog') return json(await database.catalog());
   const bearer = request.headers.get('authorization');
   if (!bearer?.startsWith('Bearer ') || bearer.length > 16384) throw new HttpError(401,'Sign in required');
   let identity; try { identity = await verifyToken(bearer.slice(7)); } catch { throw new HttpError(401,'Invalid or expired session'); }
   if (!identity?.subject || identity.email_verified !== true) throw new HttpError(401,'Verified account required');
   if (request.method === 'POST' && url.pathname === '/analysis') {
    if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415,'JSON required');
    let args;
    try { args = JSON.parse(new TextDecoder().decode(await boundedBody(request,1024))); }
    catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400,'Invalid JSON'); }
    if (!args || Array.isArray(args) || typeof args !== 'object' || Object.keys(args).length !== 2 ||
      !['p_from','p_to'].every(k => Object.hasOwn(args,k) && typeof args[k] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args[k]))) throw new HttpError(400,'Invalid date arguments');
    const dates = [args.p_from,args.p_to].map(value => new Date(`${value}T00:00:00.000Z`));
    if (dates.some((date,index) => !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== [args.p_from,args.p_to][index]) ||
      args.p_from.startsWith('0000') || args.p_to.startsWith('0000') || dates[1]-dates[0] < 0 || dates[1]-dates[0] > 365*86400000) throw new HttpError(400,'Invalid date range');
    // SQL authorizes the owner. Finish its transaction before invoking any analysis provider.
    const report = await database.withIdentity(identity, tx => tx.rpc('owner_analytics',[args.p_from,args.p_to]));
    const counts = aggregateCounts(Object.fromEntries(COUNT_FIELDS.map(field => [field,report?.[field]])));
    let outcome;
    try { outcome = await aggregateAnalysis(counts); } catch { return json({state:'unavailable'}); }
    if (outcome?.state === 'complete' && outcome.advisory_only === true && typeof outcome.advice === 'string' &&
      outcome.advice.trim() && new TextEncoder().encode(outcome.advice).length <= 8192) {
      return json({state:'complete',advice:outcome.advice,advisory_only:true});
    }
    return json({state:['disabled','unavailable','busy','invalid'].includes(outcome?.state) ? outcome.state : 'unavailable'});
   }
   if (request.method === 'POST' && url.pathname.startsWith('/rpc/')) {
    const name = url.pathname.slice(5); if (!Object.hasOwn(RPC,name)) throw new HttpError(404,'Unknown operation');
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new HttpError(415,'JSON required');
    let args; try { args=JSON.parse(new TextDecoder().decode(await boundedBody(request,131072))); } catch(error) { if(error instanceof HttpError) throw error; throw new HttpError(400,'Invalid JSON'); }
    if (!args || Array.isArray(args) || typeof args !== 'object' || Object.keys(args).some(k => !RPC[name].includes(k))) throw new HttpError(400,'Invalid arguments');
    if (RPC[name].some(k=>!(k in args))) throw new HttpError(400,'Missing arguments');
    if (['commerce_command', 'estimate_settings_command', 'product_request_command'].includes(name) && (!args.p_payload || !UUID.test(args.p_payload.request_id || ''))) throw new HttpError(400,'A request UUID is required');
    return json(await database.withIdentity(identity, tx => tx.rpc(name,RPC[name].map(k=>args[k]))));
   }
   if (request.method === 'POST' && url.pathname === '/evidence/upload') {
    const order = url.searchParams.get('order_id') || ''; if (!UUID.test(order)) throw new HttpError(400,'Invalid order');
    const bytes = await boundedBody(request,2097152); const [extension,mime] = imageType(bytes);
    return json(await database.withIdentity(identity, async tx => {
     await tx.rpc('customer_order_detail',[order]);
     const key = `${tx.userId}/${order}/${uuid()}.${extension}`;
     await storage.put(key,bytes,mime);
     // Never delete on an ambiguous database failure: a committed evidence reference
     // must not lose its object. Orphan cleanup is a separate reconciled maintenance task.
     return tx.rpc('register_payment_evidence',[key,order,bytes.length,mime]);
    }));
   }
   if (request.method === 'POST' && url.pathname === '/evidence/url') {
    let body; try { body = JSON.parse(new TextDecoder().decode(await boundedBody(request,2048))); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400,'Invalid JSON'); }
    const path = typeof body?.path === 'string' ? body.path : ''; if (!PATH.test(path)) throw new HttpError(400,'Invalid evidence path');
    return json(await database.withIdentity(identity, async tx => {
     if (!await tx.rpc('payment_evidence_access',[path])) throw new HttpError(403,'Evidence access denied');
     return {url:await storage.url(path,60)};
    }));
   }
   throw new HttpError(404,'Not found');
  } catch(error) {
   if (error instanceof HttpError) return json({error:error.message},error.status);
   // SQL errors can contain private row values, connection strings or implementation details.
   return json({error:'Operation could not be completed. Refresh records before retrying.'},400);
  }
 } };
}
