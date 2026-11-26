import { Backend } from '../_shared/backend.ts';
import { FirebaseProofVerifier, validChallenge } from '../_shared/firebase-proof.ts';
import { allowedOrigins, bearer, corsHeaders, failure, HttpError, json, preflight, record, requestBody, UUID, type Environment, type Fetcher } from '../_shared/http.ts';

export function createPhoneHandler(env: Environment, fetcher: Fetcher = fetch, now: () => number = Date.now) {
  const verifier = new FirebaseProofVerifier(fetcher, now);
  return async (request: Request): Promise<Response> => {
    let headers: Headers | undefined;
    try {
      headers = corsHeaders(request, allowedOrigins(env('ALLOWED_ORIGINS')));
      const options = preflight(request, headers);
      if (options) return options;
      const body = await requestBody(request);
      if (env('ENABLE_SMS') !== 'true') throw new HttpError(503, 'sms_disabled_use_staff_confirmation');
      const projectId = env('FIREBASE_PROJECT_ID') ?? '';
      if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) throw new HttpError(503, 'sms_configuration_required');
      if ((body.action !== 'admission' && body.action !== 'complete') || typeof body.challenge_id !== 'string' || !UUID.test(body.challenge_id)) throw new HttpError(400, 'invalid_request');
      const backend = new Backend(env, fetcher);
      const subject = await backend.googleUser(bearer(request));
      const challenge = validChallenge(await backend.rpc('phone_challenge', { p_challenge_id: body.challenge_id }), subject, now());
      if (challenge.id !== body.challenge_id) throw new HttpError(409, 'phone_challenge_expired_or_changed');
      if (body.action === 'admission') {
        // Checked before sending. NOT a provider billing cap: Firebase public client APIs
        // can be called outside this app. Provider-side controls remain essential.
        return json({ allowed: true, expires_at: challenge.expires_at }, 200, headers);
      }
      const proof = await verifier.verify(body.firebase_token, projectId, challenge);
      const result = record(await backend.rpc('phone_complete', {
        p_challenge_id: challenge.id, p_user_id: subject, p_phone: proof.phone, p_firebase_uid: proof.uid,
      }));
      if (result.verified !== true || result.phone_status !== 'sms_verified') throw new HttpError(503, 'verification_not_confirmed');
      return json({ verified: true, phone_status: 'sms_verified' }, 200, headers);
    } catch (error) { return failure(error, headers); }
  };
}
