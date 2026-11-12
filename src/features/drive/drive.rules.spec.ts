import {
  depthOf,
  isBlockedExtension,
  isInlineSafe,
  keepExtension,
  kindOf,
  moveFolderError,
  normalizeMime,
  parseTags,
  sanitizeName,
  splitExt,
  subtreeHeight,
  tagsFromDb,
  tagsToDb,
  uniqueName,
} from './drive.rules';
import { fixUploadName } from './drive.service';

describe('drive rules', () => {
  describe('names', () => {
    it('strips path separators, control chars and trailing dots', () => {
      expect(sanitizeName('../../etc/passwd')).toBe('..-..-etc-passwd');
      expect(sanitizeName('a\u0000b\nc')).toBe('abc');
      expect(sanitizeName('  Report   final.  ')).toBe('Report final');
      expect(sanitizeName(42 as any)).toBe('');
    });

    it('splits extensions sensibly', () => {
      expect(splitExt('Price.List.XLSX')).toEqual({ base: 'Price.List', ext: 'xlsx' });
      expect(splitExt('.env')).toEqual({ base: '.env', ext: '' });
      expect(splitExt('README')).toEqual({ base: 'README', ext: '' });
      expect(splitExt('weird.ext with space')).toEqual({ base: 'weird.ext with space', ext: '' });
    });

    it('keeps the stored extension on rename', () => {
      expect(keepExtension('Final quote', 'pdf')).toBe('Final quote.pdf');
      expect(keepExtension('Final quote.PDF', 'pdf')).toBe('Final quote.PDF');
      expect(keepExtension('Final quote.pdf', 'pdf')).toBe('Final quote.pdf');
      expect(keepExtension('Notes', null)).toBe('Notes');
    });

    it('generates "name (n).ext" on conflicts, case-insensitively', () => {
      expect(uniqueName('Quote.pdf', ['other.pdf'])).toBe('Quote.pdf');
      expect(uniqueName('Quote.pdf', ['quote.PDF'])).toBe('Quote (2).pdf');
      expect(uniqueName('Quote.pdf', ['Quote.pdf', 'Quote (2).pdf'])).toBe('Quote (3).pdf');
      expect(uniqueName('Quote (2).pdf', ['Quote (2).pdf'])).toBe('Quote (3).pdf');
    });

    it('re-decodes latin1-mangled UTF-8 upload names only', () => {
      const mangled = Buffer.from('रिपोर्ट.pdf', 'utf8').toString('latin1');
      expect(fixUploadName(mangled)).toBe('रिपोर्ट.pdf');
      expect(fixUploadName('रिपोर्ट.pdf')).toBe('रिपोर्ट.pdf');
      expect(fixUploadName('Café.pdf')).toBe('Café.pdf');
      expect(fixUploadName('plain.pdf')).toBe('plain.pdf');
    });
  });

  describe('types', () => {
    it('blocks executables and web pages', () => {
      ['exe', 'BAT', 'js', 'html', 'ps1', 'sh'].forEach((e) => expect(isBlockedExtension(e)).toBe(true));
      ['pdf', 'xlsx', 'png', 'zip', 'mp4'].forEach((e) => expect(isBlockedExtension(e)).toBe(false));
    });

    it('only renders safe types inline (never SVG/HTML)', () => {
      expect(isInlineSafe('image/png')).toBe(true);
      expect(isInlineSafe('application/pdf')).toBe(true);
      expect(isInlineSafe('video/mp4')).toBe(true);
      expect(isInlineSafe('image/svg+xml')).toBe(false);
      expect(isInlineSafe('text/html')).toBe(false);
      expect(isInlineSafe(null)).toBe(false);
    });

    it('normalises MIME types', () => {
      expect(normalizeMime('Text/Plain; charset=utf-8')).toBe('text/plain');
      expect(normalizeMime('nonsense')).toBe('application/octet-stream');
      expect(normalizeMime(undefined)).toBe('application/octet-stream');
    });

    it('classifies kinds by extension', () => {
      expect(kindOf('PDF')).toBe('pdf');
      expect(kindOf('xlsx')).toBe('sheet');
      expect(kindOf('jpeg')).toBe('image');
      expect(kindOf('')).toBe('other');
    });
  });

  describe('tags', () => {
    it('parses strings, arrays and JSON; lower-cases and de-dupes', () => {
      expect(parseTags('Invoice, #GST ,invoice,  ')).toEqual(['invoice', 'gst']);
      expect(parseTags(['A', 'b', 'a'])).toEqual(['a', 'b']);
      expect(parseTags('["Q1","q1","Tax 2026"]')).toEqual(['q1', 'tax 2026']);
      expect(parseTags(null)).toEqual([]);
    });

    it('caps count and length', () => {
      const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
      expect(parseTags(many)).toHaveLength(12);
      expect(parseTags(['x'.repeat(80)])[0]).toHaveLength(30);
    });

    it('round-trips the stored ",a,b," form', () => {
      expect(tagsToDb(['a', 'b'])).toBe(',a,b,');
      expect(tagsToDb([])).toBeNull();
      expect(tagsFromDb(',a,b,')).toEqual(['a', 'b']);
      expect(tagsFromDb(null)).toEqual([]);
    });
  });

  describe('folder moves', () => {
    // 1 > 2 > 3, and 4 at root
    const parentOf = new Map<number, number | null>([
      [1, null],
      [2, 1],
      [3, 2],
      [4, null],
    ]);

    it('refuses moving into itself or a descendant', () => {
      expect(moveFolderError(1, 1, parentOf)).toMatch(/itself/);
      expect(moveFolderError(1, 3, parentOf)).toMatch(/subfolders/);
      expect(moveFolderError(2, 3, parentOf)).toMatch(/subfolders/);
    });

    it('allows moving elsewhere or to the root', () => {
      expect(moveFolderError(3, 4, parentOf)).toBeNull();
      expect(moveFolderError(2, null, parentOf)).toBeNull();
      expect(moveFolderError(4, 3, parentOf)).toBeNull();
    });

    it('measures depth and subtree height', () => {
      expect(depthOf(null, parentOf)).toBe(0);
      expect(depthOf(3, parentOf)).toBe(3);
      expect(subtreeHeight(1, parentOf)).toBe(3);
      expect(subtreeHeight(4, parentOf)).toBe(1);
    });
  });
});
