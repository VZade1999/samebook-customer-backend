// The company's signature / stamp, printed above "Authorised Signatory" on
// quotations, delivery challans and tax invoices. The app sends it as a PNG
// (background already made transparent, trimmed and resized in the browser);
// these rules only accept a real, reasonably sized PNG.

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The prepared image is ~10–150 KB; anything near this is not a signature. */
export const MAX_SIGNATURE_BYTES = 1024 * 1024;
const MIN_SIDE = 8;
const MAX_SIDE = 4000;

export type ParsedSignature = { ok: true; value: Buffer | null } | { ok: false; message: string };

/** Width and height from a PNG's IHDR chunk, or null if it isn't a PNG. */
export const pngSize = (buf: Buffer): { width: number; height: number } | null => {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_MAGIC) || buf.toString('ascii', 12, 16) !== 'IHDR') {
    return null;
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
};

/**
 * A data URL (or bare base64) of a PNG → its bytes; null or "" → remove the
 * signature. Anything else is refused with a message for the user.
 */
export const parseSignature = (value: unknown): ParsedSignature => {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string') return { ok: false, message: 'Send the signature as a PNG image' };
  const trimmed = value.trim();
  const match = trimmed.match(/^data:([^;,]+);base64,(.*)$/s);
  if (match && match[1].toLowerCase() !== 'image/png') {
    return { ok: false, message: 'The signature must be a PNG image' };
  }
  const base64 = (match ? match[2] : trimmed).replace(/\s+/g, '');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return { ok: false, message: 'The signature image could not be read' };
  }
  const buf = Buffer.from(base64, 'base64');
  if (buf.length > MAX_SIGNATURE_BYTES) {
    return { ok: false, message: 'The signature image is too large (1 MB at most)' };
  }
  const size = pngSize(buf);
  if (!size) return { ok: false, message: 'The signature must be a PNG image' };
  if (size.width < MIN_SIDE || size.height < MIN_SIDE || size.width > MAX_SIDE || size.height > MAX_SIDE) {
    return { ok: false, message: 'The signature image size is not usable' };
  }
  return { ok: true, value: buf };
};

/** As the app reads it: a PNG data URL, or null when there is none. */
export const signatureDataUrl = (value: unknown): string | null => {
  if (!value) return null;
  const buf = Buffer.isBuffer(value) ? value : null;
  return buf && buf.length ? `data:image/png;base64,${buf.toString('base64')}` : null;
};
