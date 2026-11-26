import { Pool } from 'pg';
import { attachDatabasePool } from '@neon/functions';
import { createRemoteJWKSet } from 'jose';
import { createTokenVerifier } from './auth-token.mjs';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createApi } from './api.mjs';
import { createDatabase } from './database.mjs';

let application;
function setup() {
 const required = name => { const value=process.env[name]; if(!value) throw new Error('Missing server configuration'); return value; };
 const authUrl=new URL(required('NEON_AUTH_BASE_URL'));
 const jwksUrl=new URL(required('NEON_AUTH_JWKS_URL'));
 if(authUrl.protocol!=='https:' || jwksUrl.protocol!=='https:') throw new Error('HTTPS auth required');
 const jwks=createRemoteJWKSet(jwksUrl);
 // The injected owner DATABASE_URL is deliberately not a runtime fallback.
 const pool=new Pool({connectionString:required('COMMERCE_DATABASE_URL'),max:5,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
 attachDatabasePool(pool,{onUnexpectedError:()=>{}});
 const s3=new S3Client({forcePathStyle:true,endpoint:required('AWS_ENDPOINT_URL_S3'),region:required('AWS_REGION'),maxAttempts:1});
 const bucket=process.env.PAYMENT_EVIDENCE_BUCKET || 'assets';
 return createApi({database:createDatabase(pool),origins:required('ALLOWED_ORIGINS').split(',').map(v=>v.trim()).filter(Boolean),
  verifyToken: createTokenVerifier({key:jwks,issuer:authUrl.origin,googleOnlyConfirmed:()=>process.env.NEON_GOOGLE_ONLY_CONFIRMED==='true'}),storage:{
   put:(key,bytes,mime)=>s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:mime,CacheControl:'private, no-store',IfNoneMatch:'*'})),
   url:(key,seconds)=>getSignedUrl(s3,new GetObjectCommand({Bucket:bucket,Key:key,ResponseContentDisposition:'attachment',ResponseCacheControl:'private, no-store'}),{expiresIn:seconds}),
  }});
}
export default { async fetch(request) {
 try { application ??= setup(); return await application.fetch(request); }
 catch { return Response.json({error:'Backend configuration unavailable'},{status:503,headers:{'Cache-Control':'no-store'}}); }
}};
