export const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;
export const EVIDENCE_BUCKET = 'payment-evidence';
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const EVIDENCE_PATH = new RegExp(`^${uuid}/${uuid}/${uuid}\\.(?:jpg|jpeg|png|webp)$`, 'i');
export const UUID_PATTERN = new RegExp(`^${uuid}$`, 'i');

export function evidenceFormat(bytes: Uint8Array): { extension: string; mime: string } {
  if (bytes.length > MAX_EVIDENCE_BYTES) throw new Error('Payment screenshots must be 2 MiB or smaller.');
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) {
    return { extension: 'png', mime: 'image/png' };
  }
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return { extension: 'jpg', mime: 'image/jpeg' };
  }
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    return { extension: 'webp', mime: 'image/webp' };
  }
  throw new Error('Choose a PNG, JPEG, or WebP screenshot. Other file formats are not accepted.');
}
