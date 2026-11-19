import { MAX_SIGNATURE_BYTES, parseSignature, pngSize, signatureDataUrl } from './signature.rules';

/** The smallest valid-looking PNG header: magic, then an IHDR chunk with width and height. */
const png = (width: number, height: number, extra = 0) => {
  const buf = Buffer.alloc(33 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
};
const dataUrl = (buf: Buffer, type = 'image/png') => `data:${type};base64,${buf.toString('base64')}`;

describe('company signature', () => {
  it('accepts a PNG data URL or bare base64', () => {
    const img = png(600, 200);
    const a = parseSignature(dataUrl(img));
    expect(a).toEqual({ ok: true, value: img });
    const b = parseSignature(img.toString('base64'));
    expect(b.ok && b.value?.equals(img)).toBe(true);
  });

  it('treats null or empty as "remove"', () => {
    expect(parseSignature(null)).toEqual({ ok: true, value: null });
    expect(parseSignature('')).toEqual({ ok: true, value: null });
    expect(parseSignature('   ')).toEqual({ ok: true, value: null });
  });

  it('refuses other image types, junk and non-strings', () => {
    expect(parseSignature(dataUrl(png(10, 10), 'image/jpeg'))).toEqual({ ok: false, message: 'The signature must be a PNG image' });
    expect(parseSignature(dataUrl(Buffer.from('not a png at all, just text')))).toEqual({ ok: false, message: 'The signature must be a PNG image' });
    expect(parseSignature('data:image/png;base64,***')).toEqual({ ok: false, message: 'The signature image could not be read' });
    expect(parseSignature(42)).toEqual({ ok: false, message: 'Send the signature as a PNG image' });
  });

  it('refuses images that are too big or a strange size', () => {
    expect(parseSignature(dataUrl(png(600, 200, MAX_SIGNATURE_BYTES)))).toEqual({ ok: false, message: 'The signature image is too large (1 MB at most)' });
    expect(parseSignature(dataUrl(png(4, 200)))).toEqual({ ok: false, message: 'The signature image size is not usable' });
    expect(parseSignature(dataUrl(png(600, 9000)))).toEqual({ ok: false, message: 'The signature image size is not usable' });
  });

  it('reads the size from the PNG header', () => {
    expect(pngSize(png(720, 240))).toEqual({ width: 720, height: 240 });
    expect(pngSize(Buffer.from('hello'))).toBeNull();
  });

  it('gives the app a data URL, or null', () => {
    const img = png(20, 20);
    expect(signatureDataUrl(img)).toBe(dataUrl(img));
    expect(signatureDataUrl(null)).toBeNull();
    expect(signatureDataUrl(Buffer.alloc(0))).toBeNull();
  });
});
