import { checkReadiness, isCli, reportFailure, ReleaseError } from './release-readiness.mjs';

// Deliberately fail closed until a reviewed upload implementation can verify
// bundle identity/signature and preserve existing Play edits and review state.
export async function publishPlay() {
  await checkReadiness({ mode: 'publish' });
  throw new ReleaseError('PLAY_UPLOAD_NOT_IMPLEMENTED', 'No Play write was attempted. Use the approved Console process after signing and review; automated upload remains blocked.');
}
if (isCli(import.meta.url)) publishPlay().catch(reportFailure);
