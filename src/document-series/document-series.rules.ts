// Pure rules for document numbering series — no DB, unit-tested.
//
// A series is a format such as "{PREFIX}/{FY}/{SEQ}" plus a running number that
// can restart every financial year, month or day. Dates are taken in the
// business time zone (India), never the server's (UTC on Vercel).

export const DOC_TYPES = ['INVOICE', 'QUOTATION', 'DELIVERY_CHALLAN'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const RESET_PERIODS = ['NEVER', 'YEARLY', 'MONTHLY', 'DAILY'] as const;
export type ResetPeriod = (typeof RESET_PERIODS)[number];

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  INVOICE: 'Invoice',
  QUOTATION: 'Quotation',
  DELIVERY_CHALLAN: 'Delivery challan',
};

export const BUSINESS_TZ = 'Asia/Kolkata';
/** Indian financial year: April to March. */
export const FY_START_MONTH = 4;

export const TOKENS = ['SEQ', 'FY', 'FY_LONG', 'YYYY', 'YY', 'MM', 'DD', 'PREFIX'] as const;
export type Token = (typeof TOKENS)[number];

export const LIMITS = {
  nameMax: 60,
  formatMax: 80,
  renderedMax: 40,
  paddingMin: 1,
  paddingMax: 9,
  nextMin: 1,
  nextMax: 999_999_999,
  /** GST rule 46(b): invoice numbers up to 16 characters, letters, digits, "-" and "/". */
  gstInvoiceMax: 16,
};

// Characters allowed outside tokens. "#", "_" and "." are fine for quotations
// and challans; invoices get a GST warning for anything but "-" and "/".
const LITERAL_OK = /^[A-Za-z0-9\-\/_.#]*$/;
const GST_LITERAL_OK = /^[A-Za-z0-9\-\/]*$/;
const TOKEN_RE = /\{([^{}]*)\}/g;

export interface DateParts {
  y: number;
  m: number; // 1-12
  d: number;
}

const partsFormatter = new Map<string, Intl.DateTimeFormat>();

/** Calendar date of `date` in the business time zone. */
export function datePartsIn(date: Date, tz: string = BUSINESS_TZ): DateParts {
  let f = partsFormatter.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    partsFormatter.set(tz, f);
  }
  const get = (type: string) => Number(f!.formatToParts(date).find((p) => p.type === type)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** Start year of the financial year containing `p` (Apr 2025 – Mar 2026 → 2025). */
export const fyStartYear = (p: DateParts) => (p.m >= FY_START_MONTH ? p.y : p.y - 1);

const pad = (n: number, w: number) => String(n).padStart(w, '0');
const yy = (y: number) => pad(y % 100, 2);

/** Which counter period `p` falls in; the counter restarts when this changes. */
export function periodKey(reset: ResetPeriod, p: DateParts): string {
  switch (reset) {
    case 'YEARLY':
      return `FY${fyStartYear(p)}`;
    case 'MONTHLY':
      return `${p.y}-${pad(p.m, 2)}`;
    case 'DAILY':
      return `${p.y}-${pad(p.m, 2)}-${pad(p.d, 2)}`;
    default:
      return 'ALL';
  }
}

/** Number the next document gets, given the stored counter and today's period. */
export function effectiveNext(series: { next_number: number; current_period: string | null; reset_period: ResetPeriod }, p: DateParts): number {
  const key = periodKey(series.reset_period, p);
  if (series.current_period && series.current_period !== key) return 1;
  return Math.max(1, Number(series.next_number) || 1);
}

export interface RenderInput {
  format: string;
  padding: number;
  seq: number;
  prefix?: string | null;
  parts: DateParts;
}

export function tokenValue(token: string, i: RenderInput): string | null {
  const { parts: p } = i;
  const fy = fyStartYear(p);
  switch (token) {
    case 'SEQ':
      return pad(i.seq, i.padding);
    case 'FY':
      return `${yy(fy)}-${yy(fy + 1)}`;
    case 'FY_LONG':
      return `${fy}-${yy(fy + 1)}`;
    case 'YYYY':
      return String(p.y);
    case 'YY':
      return yy(p.y);
    case 'MM':
      return pad(p.m, 2);
    case 'DD':
      return pad(p.d, 2);
    case 'PREFIX':
      return (i.prefix || '').trim().toUpperCase() || 'COMP';
    default:
      return null;
  }
}

export function renderNumber(i: RenderInput): string {
  return i.format.replace(TOKEN_RE, (whole, name: string) => tokenValue(name.trim().toUpperCase(), i) ?? whole);
}

export interface SeriesInput {
  doc_type: DocType;
  name: string;
  format: string;
  padding: number;
  reset_period: ResetPeriod;
  next_number: number;
}

export interface Validation {
  errors: string[];
  warnings: string[];
  /** The number the next document would get, when the format is valid. */
  preview: string | null;
}

/** Tokens used in a format, upper-cased; unknown names kept as written. */
export function tokensIn(format: string): string[] {
  return [...format.matchAll(TOKEN_RE)].map((m) => m[1].trim().toUpperCase());
}

const literalsOf = (format: string) => format.replace(TOKEN_RE, '');

export function validateSeries(s: SeriesInput, ctx: { prefix?: string | null; now: Date }): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = String(s.name ?? '').trim();
  const format = String(s.format ?? '').trim();

  if (!(DOC_TYPES as readonly string[]).includes(s.doc_type)) errors.push('Unknown document type');
  if (!name) errors.push('Give the series a name');
  else if (name.length > LIMITS.nameMax) errors.push(`Name can be at most ${LIMITS.nameMax} characters`);
  if (!(RESET_PERIODS as readonly string[]).includes(s.reset_period)) errors.push('Choose when the number restarts');

  const padding = Number(s.padding);
  if (!Number.isInteger(padding) || padding < LIMITS.paddingMin || padding > LIMITS.paddingMax) {
    errors.push(`Digits must be between ${LIMITS.paddingMin} and ${LIMITS.paddingMax}`);
  }
  const next = Number(s.next_number);
  if (!Number.isInteger(next) || next < LIMITS.nextMin || next > LIMITS.nextMax) {
    errors.push('Next number must be a whole number from 1 to 999,999,999');
  }

  if (!format) {
    errors.push('Enter a format, e.g. {PREFIX}/{FY}/{SEQ}');
    return { errors, warnings, preview: null };
  }
  if (format.length > LIMITS.formatMax) errors.push(`Format can be at most ${LIMITS.formatMax} characters`);

  const literals = literalsOf(format);
  if (/[{}]/.test(literals)) errors.push('A { or } is not closed — tokens look like {SEQ}');
  else if (!LITERAL_OK.test(literals)) errors.push('Use only letters, numbers and - / _ . # outside the {tokens} (no spaces)');

  const used = tokensIn(format);
  const unknown = [...new Set(used.filter((t) => !(TOKENS as readonly string[]).includes(t)))];
  if (unknown.length) errors.push(`Unknown ${unknown.length > 1 ? 'tokens' : 'token'}: ${unknown.map((t) => `{${t}}`).join(', ')}`);
  const seqCount = used.filter((t) => t === 'SEQ').length;
  if (seqCount === 0) errors.push('The format must contain {SEQ} — the running number');
  else if (seqCount > 1) errors.push('{SEQ} can appear only once');

  // A counter that restarts must sit next to the period it restarts in, or the
  // numbers would repeat (e.g. INV/0001 again every April).
  const has = (...t: string[]) => t.some((x) => used.includes(x));
  const year = has('FY', 'FY_LONG', 'YYYY', 'YY');
  if (s.reset_period === 'YEARLY' && !has('FY', 'FY_LONG')) {
    errors.push('Numbers restart every financial year, so add {FY} (e.g. 25-26) or {FY_LONG} (2025-26) to the format');
  } else if (s.reset_period === 'MONTHLY' && !(year && has('MM'))) {
    errors.push('Numbers restart every month, so the format needs a year ({FY}, {YYYY} or {YY}) and {MM}');
  } else if (s.reset_period === 'DAILY' && !(year && has('MM') && has('DD'))) {
    errors.push('Numbers restart every day, so the format needs a year, {MM} and {DD}');
  }

  if (errors.length) return { errors, warnings, preview: null };

  const parts = datePartsIn(ctx.now);
  const preview = renderNumber({ format, padding, seq: next, prefix: ctx.prefix, parts });
  if (preview.length > LIMITS.renderedMax) {
    errors.push(`Numbers would be ${preview.length} characters long — keep them to ${LIMITS.renderedMax}`);
    return { errors, warnings, preview };
  }

  if (s.doc_type === 'INVOICE') {
    if (!GST_LITERAL_OK.test(literals)) {
      warnings.push('GST invoice numbers may only use letters, numbers, "-" and "/"');
    }
    // Longest the number gets this period: the counter may grow past `padding`.
    const longest = Math.max(preview.length, renderNumber({ format, padding, seq: Math.max(next, 10 ** padding - 1), prefix: ctx.prefix, parts }).length);
    if (longest > LIMITS.gstInvoiceMax) {
      warnings.push(`GST allows invoice numbers of up to ${LIMITS.gstInvoiceMax} characters; these can reach ${longest}`);
    }
  }
  if (s.reset_period === 'NEVER' && has('FY', 'FY_LONG', 'YYYY', 'YY', 'MM', 'DD')) {
    warnings.push("The date part changes but the number never restarts — that's fine if you want one continuous count");
  }
  return { errors, warnings, preview };
}

/** Example of the standard (built-in) format, for screens that explain it. */
export function standardExample(docType: DocType, prefix: string | null | undefined, now: Date): string {
  const p = datePartsIn(now);
  const code = (prefix || '').trim().toUpperCase() || 'COMP';
  const ymd = `${yy(p.y)}${pad(p.m, 2)}${pad(p.d, 2)}`;
  if (docType === 'INVOICE') return `INV-${p.y}${pad(p.m, 2)}${pad(p.d, 2)}-0001`;
  if (docType === 'QUOTATION') return `QT-${code}-${ymd}-001-0001`;
  return `DC-${code}-${ymd}-001-0001`;
}

/** Start of the business-time-zone day containing `now`, as an absolute instant. */
export function businessDayStart(now: Date, tz: string = BUSINESS_TZ): Date {
  const p = datePartsIn(now, tz);
  // Offset of the zone at that moment (India has no DST, but stay general).
  const asUtc = Date.UTC(p.y, p.m - 1, p.d);
  const probe = new Date(asUtc);
  const local = datePartsIn(probe, tz);
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const [hh, mm] = f.format(probe).split(':').map(Number);
  const offsetMin = (Date.UTC(local.y, local.m - 1, local.d) - asUtc) / 60000 + hh * 60 + mm;
  return new Date(asUtc - offsetMin * 60000);
}
