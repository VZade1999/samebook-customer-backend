// Pure Drive rules: names, tags, file types, folder moves. No DB or disk access,
// so all of it is unit-tested in drive.rules.spec.ts.

export const MAX_TAGS = 12;
export const MAX_TAG_LEN = 30;
export const MAX_FOLDER_DEPTH = 12;

export const FOLDER_COLORS = [
  'indigo',
  'blue',
  'teal',
  'green',
  'amber',
  'orange',
  'rose',
  'violet',
  'slate',
] as const;

/** Executables and scripts are refused outright: Drive is for documents and media. */
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'dll', 'sys',
  'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'ps1', 'psm1', 'sh', 'bash',
  'jar', 'app', 'apk', 'msp', 'reg', 'lnk', 'hta', 'html', 'htm', 'xhtml', 'svgz', 'php',
]);

/**
 * MIME types that are safe to render inline in the browser (served with
 * nosniff). Everything else, including SVG and HTML, is always a download.
 */
const INLINE_MIME = [
  /^image\/(png|jpe?g|gif|webp|bmp|avif)$/,
  /^application\/pdf$/,
  /^text\/(plain|csv)$/,
  /^video\/(mp4|webm|ogg|quicktime)$/,
  /^audio\/(mpeg|mp3|wav|ogg|webm|aac|mp4|x-m4a)$/,
];

export type FileKind =
  | 'image'
  | 'pdf'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'text'
  | 'archive'
  | 'video'
  | 'audio'
  | 'other';

const KIND_BY_EXT: Record<string, FileKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', avif: 'image', heic: 'image',
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', pages: 'doc',
  xls: 'sheet', xlsx: 'sheet', ods: 'sheet', csv: 'sheet', numbers: 'sheet',
  ppt: 'slides', pptx: 'slides', odp: 'slides', key: 'slides',
  txt: 'text', md: 'text', json: 'text', xml: 'text', log: 'text',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  mp4: 'video', mov: 'video', webm: 'video', avi: 'video', mkv: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio',
};

export const kindOf = (ext: string | null | undefined): FileKind =>
  (ext && KIND_BY_EXT[ext.toLowerCase()]) || 'other';

/** Strip path separators, control characters and trailing dots/spaces. */
export const sanitizeName = (raw: unknown, max = 200): string => {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, max)
    .trim();
};

/** "Report.Final.PDF" -> { base: "Report.Final", ext: "pdf" }. Dotfiles have no ext. */
export const splitExt = (name: string): { base: string; ext: string } => {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return { base: name, ext: '' };
  const ext = name.slice(i + 1).toLowerCase();
  if (!/^[a-z0-9]{1,15}$/.test(ext)) return { base: name, ext: '' };
  return { base: name.slice(0, i), ext };
};

export const isBlockedExtension = (ext: string) => BLOCKED_EXTENSIONS.has(ext.toLowerCase());

export const isInlineSafe = (mime: string | null | undefined) =>
  !!mime && INLINE_MIME.some((re) => re.test(mime.toLowerCase()));

/** Client-supplied MIME types are only trusted when they look like a MIME type. */
export const normalizeMime = (mime: unknown): string => {
  if (typeof mime !== 'string') return 'application/octet-stream';
  const m = mime.toLowerCase().split(';')[0].trim();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(m) && m.length <= 150
    ? m
    : 'application/octet-stream';
};

/**
 * Accepts "a, b" | ["a","b"] | JSON '["a"]'. Lower-cases, trims, de-dupes and
 * caps. Commas can't appear inside a tag (they delimit the stored form).
 */
export const parseTags = (raw: unknown): string[] => {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string') {
    const s = raw.trim();
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s);
        list = Array.isArray(parsed) ? parsed : [];
      } catch {
        list = s.split(',');
      }
    } else list = s.split(',');
  }
  const out: string[] = [];
  for (const t of list) {
    if (typeof t !== 'string') continue;
    const tag = t
      .toLowerCase()
      .replace(/[,\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^#+\s*/, '')
      .slice(0, MAX_TAG_LEN)
      .trim();
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
};

/** ["a","b"] -> ",a,b," (null when empty). */
export const tagsToDb = (tags: string[]): string | null => (tags.length ? `,${tags.join(',')},` : null);
export const tagsFromDb = (stored: string | null | undefined): string[] =>
  stored ? stored.split(',').filter(Boolean) : [];

/** "Quote.pdf" taken -> "Quote (2).pdf", then "Quote (3).pdf"... (case-insensitive). */
export const uniqueName = (name: string, taken: string[]): string => {
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  const { base, ext } = splitExt(name);
  const stem = base.replace(/ \(\d+\)$/, '');
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${stem} (${i})${ext ? `.${ext}` : ''}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
  return `${stem} (${Date.now()})${ext ? `.${ext}` : ''}`;
};

/**
 * Keeps the file's extension when a user renames "Quote.pdf" to "Final quote":
 * the stored blob is still a PDF, so the name should say so.
 */
export const keepExtension = (newName: string, ext: string | null | undefined): string => {
  if (!ext) return newName;
  return splitExt(newName).ext === ext.toLowerCase() ? newName : `${newName}.${ext.toLowerCase()}`;
};

/**
 * Can `folderId` move under `newParentId`? Not into itself, not into one of
 * its own descendants, and not deeper than MAX_FOLDER_DEPTH.
 * `parentOf` maps every folder id of the company to its parent id.
 */
export const moveFolderError = (
  folderId: number,
  newParentId: number | null,
  parentOf: Map<number, number | null>,
): string | null => {
  if (newParentId === null) return null;
  if (newParentId === folderId) return 'A folder cannot be moved into itself';
  let cursor: number | null = newParentId;
  let depth = 0;
  while (cursor !== null && cursor !== undefined) {
    if (cursor === folderId) return 'A folder cannot be moved into one of its own subfolders';
    cursor = parentOf.get(cursor) ?? null;
    if (++depth > MAX_FOLDER_DEPTH * 4) return 'Folder structure is too deep';
  }
  return null;
};

/** Depth of a folder (root children = 1). */
export const depthOf = (folderId: number | null, parentOf: Map<number, number | null>): number => {
  let depth = 0;
  let cursor = folderId;
  while (cursor !== null && cursor !== undefined && depth <= MAX_FOLDER_DEPTH * 4) {
    depth++;
    cursor = parentOf.get(cursor) ?? null;
  }
  return depth;
};

/** Height of the subtree rooted at folderId (a leaf = 1). */
export const subtreeHeight = (folderId: number, parentOf: Map<number, number | null>): number => {
  const children = new Map<number, number[]>();
  parentOf.forEach((p, id) => {
    if (p !== null) (children.get(p) || children.set(p, []).get(p)!).push(id);
  });
  const walk = (id: number, guard: number): number =>
    guard > MAX_FOLDER_DEPTH * 4
      ? guard
      : 1 + Math.max(0, ...(children.get(id) || []).map((c) => walk(c, guard + 1)));
  return walk(folderId, 0);
};
