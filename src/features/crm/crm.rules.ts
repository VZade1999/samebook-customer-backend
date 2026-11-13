// Pure rules for the CRM add-on (no DB, no network): pipeline, access,
// normalisation, follow-up timing, assignment and the lead-source mappers
// (IndiaMART + generic webhooks). Unit tested in crm.rules.spec.ts.

// ─── Pipeline ───────────────────────────────────────────────────────────────

export const STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTED', 'NEGOTIATION', 'WON', 'LOST'] as const;
export type Stage = (typeof STAGES)[number];
export const OPEN_STAGES: readonly Stage[] = ['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTED', 'NEGOTIATION'];
export const isOpenStage = (s: unknown): boolean => OPEN_STAGES.includes(s as Stage);
export const STAGE_LABEL: Record<Stage, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  QUOTED: 'Quoted',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Lost',
};
/** Position in the pipeline (WON and LOST share the last step). */
export const stageRank = (s: string) => (s === 'LOST' ? STAGES.indexOf('WON') : STAGES.indexOf(s as Stage));

/** Where a lead naturally goes when someone first works on it. */
export const stageAfterContact = (s: string): Stage | null => (s === 'NEW' ? 'CONTACTED' : null);
/** A quotation was made for the lead's customer. */
export const stageAfterQuotation = (s: string): Stage | null =>
  ['NEW', 'CONTACTED', 'QUALIFIED'].includes(s) ? 'QUOTED' : null;

// ─── Sources (where a lead came from) ───────────────────────────────────────

export const SOURCES = [
  'INDIAMART',
  'WEBSITE',
  'FACEBOOK',
  'GOOGLE',
  'JUSTDIAL',
  'TRADEINDIA',
  'WHATSAPP',
  'PHONE',
  'WALK_IN',
  'REFERRAL',
  'EXHIBITION',
  'EMAIL',
  'OTHER',
] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABEL: Record<Source, string> = {
  INDIAMART: 'IndiaMART',
  WEBSITE: 'Website',
  FACEBOOK: 'Facebook / Instagram',
  GOOGLE: 'Google Ads',
  JUSTDIAL: 'JustDial',
  TRADEINDIA: 'TradeIndia',
  WHATSAPP: 'WhatsApp',
  PHONE: 'Phone call',
  WALK_IN: 'Walk-in',
  REFERRAL: 'Referral',
  EXHIBITION: 'Exhibition',
  EMAIL: 'Email',
  OTHER: 'Other',
};
export const isSource = (v: unknown): v is Source => SOURCES.includes(v as Source);

/** Integrations that deliver leads by themselves. */
export const INTEGRATION_TYPES = ['INDIAMART', 'WEBHOOK'] as const;
export type IntegrationType = (typeof INTEGRATION_TYPES)[number];

export const RATINGS = ['HOT', 'WARM', 'COLD'] as const;
export type Rating = (typeof RATINGS)[number];

/** Activities a person logs. System entries use other types (see ACTIVITY_SYSTEM). */
export const LOG_TYPES = ['CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'NOTE'] as const;
export type LogType = (typeof LOG_TYPES)[number];
export const ACTIVITY_SYSTEM = [
  'CREATED',
  'ENQUIRY',
  'STAGE',
  'ASSIGNED',
  'FOLLOW_UP',
  'CONVERTED',
  'QUOTATION',
  'UPDATED',
] as const;
/** Logged types that count as "we responded to the lead". */
export const RESPONSE_TYPES: readonly string[] = ['CALL', 'WHATSAPP', 'EMAIL', 'MEETING'];

export const CALL_OUTCOMES = [
  'CONNECTED',
  'NO_ANSWER',
  'BUSY',
  'SWITCHED_OFF',
  'CALL_BACK',
  'WRONG_NUMBER',
  'NOT_INTERESTED',
] as const;

export const leadKey = (n: number | string) => `LD-${n}`;
/** "LD-12" / "ld 12" / "12" → 12. */
export const parseLeadKey = (s: string): number | null => {
  const m = /^\s*(?:ld[\s-]*)?(\d{1,9})\s*$/i.exec(s || '');
  return m ? Number(m[1]) : null;
};

// ─── Normalisation ──────────────────────────────────────────────────────────

/** Trimmed, single-spaced, capped; '' → null. */
export const clean = (v: unknown, max = 300): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

/** Multi-line text: keeps line breaks, trims each line, caps the length. */
export const cleanText = (v: unknown, max = 5000): string | null => {
  if (v === null || v === undefined || typeof v === 'object') return null;
  const s = String(v)
    .replace(/\\r\\n|\\n|\\r/g, '\n') // literal "\n" sequences some APIs send
    .replace(/\\t/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Indian mobiles become 10 digits (so +91-98…, 098…, 98… all match);
 * other numbers keep their digits, with + when an international prefix was given.
 */
export const normalizePhone = (v: unknown): string | null => {
  if (v === null || v === undefined || typeof v === 'object') return null;
  const raw = String(v).trim();
  if (!raw) return null;
  const intl = raw.startsWith('+') || raw.startsWith('00');
  let d = raw.replace(/\D/g, '');
  if (raw.startsWith('00')) d = d.slice(2);
  if (!d) return null;
  if (d.length === 12 && d.startsWith('91') && /^[6-9]/.test(d.slice(2))) return d.slice(2);
  if (d.length === 11 && d.startsWith('0') && /^[6-9]/.test(d.slice(1))) return d.slice(1);
  if (d.length === 10 && /^[6-9]/.test(d)) return d;
  if (d.length < 6 || d.length > 15) return null;
  return intl ? `+${d}` : d;
};

export const isIndianMobile = (p?: string | null) => !!p && /^[6-9]\d{9}$/.test(p);

/** The part of a phone number used to match records (last 10 digits). */
export const phoneMatchKey = (p?: string | null): string | null => {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length < 6) return null;
  return d.length > 10 ? d.slice(-10) : d;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const normalizeEmail = (v: unknown): string | null => {
  const s = clean(v, 200);
  if (!s) return null;
  const e = s.toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
};

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const normalizeGstin = (v: unknown): string | null => {
  const s = clean(v, 30);
  if (!s) return null;
  const g = s.replace(/\s+/g, '').toUpperCase();
  return GSTIN_RE.test(g) ? g : null;
};

export const normalizePincode = (v: unknown): string | null => {
  const s = clean(v, 20);
  if (!s) return null;
  const d = s.replace(/\s+/g, '');
  return /^[A-Za-z0-9-]{3,10}$/.test(d) ? d.toUpperCase() : null;
};

/** "₹ 1,50,000" / "150000.5" / 2e5 → number ≥ 0 (2 decimals), else null. */
export const parseAmount = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 999_999_999_999) return null;
  return Math.round(n * 100) / 100;
};

// ─── Access ─────────────────────────────────────────────────────────────────

export interface CrmActor {
  userId: number;
  isManager: boolean;
}
export interface LeadOwnership {
  owner_id?: number | null;
  created_by?: number | null;
}

const same = (a: unknown, b: unknown) => a != null && b != null && Number(a) === Number(b);

/**
 * Who sees a lead: managers see everything; others see leads they own, leads
 * they created and unassigned leads (the shared pool, so nothing is missed).
 */
export const canSeeLead = (l: LeadOwnership, a: CrmActor) =>
  a.isManager || l.owner_id == null || same(l.owner_id, a.userId) || same(l.created_by, a.userId);

export interface LeadCapabilities {
  work: boolean;
  assign: boolean;
  claim: boolean;
  delete: boolean;
}

export const leadCapabilities = (l: LeadOwnership, a: CrmActor): LeadCapabilities => {
  const work = canSeeLead(l, a);
  return {
    work,
    assign: a.isManager,
    claim: !a.isManager && l.owner_id == null,
    delete: a.isManager || (same(l.created_by, a.userId) && l.owner_id != null && same(l.owner_id, a.userId)),
  };
};

/** A salesperson who acts on an unassigned lead takes it, so two people don't call the same buyer. */
export const shouldAutoClaim = (l: LeadOwnership, a: CrmActor) => !a.isManager && l.owner_id == null;

// ─── Time ───────────────────────────────────────────────────────────────────

export const DEFAULT_TZ_MIN = 330; // IST

/** Minutes east of UTC from a query value (-720..840), default IST. */
export const parseTz = (v: unknown): number => {
  const n = Number(v);
  return Number.isInteger(n) && n >= -720 && n <= 840 ? n : DEFAULT_TZ_MIN;
};

/** UTC instants bounding the viewer's local day that contains `now`. */
export const localDayBounds = (now: Date, tzMin: number) => {
  const local = new Date(now.getTime() + tzMin * 60_000);
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const start = new Date(startLocal - tzMin * 60_000);
  return { start, end: new Date(start.getTime() + 86_400_000) };
};

/** Local calendar date (YYYY-MM-DD) of an instant. */
export const localDate = (d: Date, tzMin: number) =>
  new Date(d.getTime() + tzMin * 60_000).toISOString().slice(0, 10);

export type FollowUpState = 'OVERDUE' | 'TODAY' | 'UPCOMING' | null;

export const followUpState = (
  l: { next_follow_up_at?: Date | string | null; stage?: string },
  now: Date,
  endOfToday: Date,
): FollowUpState => {
  if (!l.next_follow_up_at || !isOpenStage(l.stage)) return null;
  const at = new Date(l.next_follow_up_at).getTime();
  if (at < now.getTime()) return 'OVERDUE';
  return at < endOfToday.getTime() ? 'TODAY' : 'UPCOMING';
};

export const isIsoDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** UTC instant of local midnight at the start of an ISO date. */
export const localMidnightUtc = (iso: string, tzMin: number) =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() - tzMin * 60_000);

export const addDays = (iso: string, n: number) =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

export const daysInclusive = (from: string, to: string) =>
  Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000) + 1;

export const MAX_RANGE_DAYS = 731;

/** Did this logged activity reach the person (moves a NEW lead to CONTACTED)? */
export const reachedPerson = (type: string, outcome?: string | null) => {
  if (type === 'NOTE') return false;
  if (type !== 'CALL') return true;
  return !['NO_ANSWER', 'BUSY', 'SWITCHED_OFF', 'WRONG_NUMBER'].includes(String(outcome || ''));
};

/** Median of a list of numbers (null when empty). */
export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** Furthest pipeline step a lead reached, from its stage history + current stage. */
export const furthestRank = (current: string, history: string[]) => {
  const ranks = [...history, current].filter((s) => s && s !== 'LOST').map((s) => stageRank(s));
  return Math.max(0, ...ranks.filter((r) => r >= 0));
};

// ─── Assignment of incoming leads ───────────────────────────────────────────

export const ASSIGN_MODES = ['POOL', 'USER', 'ROUND_ROBIN'] as const;
export type AssignMode = (typeof ASSIGN_MODES)[number];

export interface SourceSettings {
  assign_mode: AssignMode;
  assign_user_ids: number[];
  /** Tag put on leads from this source (webhooks: Website, Facebook…). */
  lead_source: Source;
  default_rating: Rating | null;
  /** Webhook: where a browser is sent after a plain HTML form post. */
  redirect_url: string | null;
}

export const defaultSettings = (type: string): SourceSettings => ({
  assign_mode: 'POOL',
  assign_user_ids: [],
  lead_source: type === 'INDIAMART' ? 'INDIAMART' : 'WEBSITE',
  default_rating: null,
  redirect_url: null,
});

export const safeHttpUrl = (v: unknown): string | null => {
  const s = clean(v, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
};

/** Parses stored settings, tolerating junk (falls back to defaults field by field). */
export const parseSettings = (raw: unknown, type: string): SourceSettings => {
  const d = defaultSettings(type);
  let o: any = {};
  try {
    o = typeof raw === 'string' && raw ? JSON.parse(raw) : raw && typeof raw === 'object' ? raw : {};
  } catch {
    o = {};
  }
  const ids = Array.isArray(o.assign_user_ids)
    ? [...new Set(o.assign_user_ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))]
    : [];
  return {
    assign_mode: ASSIGN_MODES.includes(o.assign_mode) ? o.assign_mode : d.assign_mode,
    assign_user_ids: ids as number[],
    lead_source: type === 'INDIAMART' ? 'INDIAMART' : isSource(o.lead_source) ? o.lead_source : d.lead_source,
    default_rating: RATINGS.includes(o.default_rating) ? o.default_rating : null,
    redirect_url: type === 'WEBHOOK' ? safeHttpUrl(o.redirect_url) : null,
  };
};

/**
 * Owner for a new incoming lead. `eligible` = active users who can use the
 * CRM; anyone no longer eligible is skipped. Returns the next cursor so
 * round-robin keeps rotating fairly.
 */
export const pickAssignee = (
  s: Pick<SourceSettings, 'assign_mode' | 'assign_user_ids'>,
  eligible: number[],
  cursor: number,
): { ownerId: number | null; cursor: number } => {
  const ok = new Set(eligible.map(Number));
  const list = s.assign_user_ids.filter((id) => ok.has(Number(id)));
  if (s.assign_mode === 'USER') return { ownerId: list[0] ?? null, cursor };
  if (s.assign_mode === 'ROUND_ROBIN' && list.length) {
    const c = Math.max(0, Number(cursor) || 0);
    return { ownerId: list[c % list.length], cursor: c + 1 };
  }
  return { ownerId: null, cursor };
};

// ─── Incoming leads ─────────────────────────────────────────────────────────

export interface InboundLead {
  name: string;
  company_name: string | null;
  phone: string | null;
  alt_phone: string | null;
  email: string | null;
  gst_number: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string | null;
  requirement: string | null;
  message: string | null;
  estimated_value: number | null;
  source: Source;
  source_ref: string | null;
  source_detail: string | null;
  received_at: Date | null;
}

const blankLead = (source: Source): InboundLead => ({
  name: '',
  company_name: null,
  phone: null,
  alt_phone: null,
  email: null,
  gst_number: null,
  address: null,
  city: null,
  state: null,
  pincode: null,
  country: null,
  requirement: null,
  message: null,
  estimated_value: null,
  source,
  source_ref: null,
  source_detail: null,
  received_at: null,
});

/** Fields of an existing lead that a repeat enquiry may fill in (never overwrites). */
export const fillBlanks = (lead: Record<string, any>, inbound: InboundLead): Record<string, any> => {
  const patch: Record<string, any> = {};
  const keys: (keyof InboundLead)[] = [
    'company_name',
    'email',
    'gst_number',
    'address',
    'city',
    'state',
    'pincode',
    'country',
    'requirement',
  ];
  keys.forEach((k) => {
    if ((lead[k] === null || lead[k] === undefined || lead[k] === '') && inbound[k]) patch[k] = inbound[k];
  });
  if (!lead.phone && inbound.phone) patch.phone = inbound.phone;
  else if (!lead.alt_phone && inbound.phone && phoneMatchKey(inbound.phone) !== phoneMatchKey(lead.phone)) {
    patch.alt_phone = inbound.phone;
  }
  if ((lead.estimated_value === null || lead.estimated_value === undefined) && inbound.estimated_value != null) {
    patch.estimated_value = inbound.estimated_value;
  }
  return patch;
};

/** A lead needs a way to reach the person. */
export const inboundError = (l: InboundLead): string | null =>
  !l.phone && !l.email ? 'A phone number or an email address is required' : null;

// ── IndiaMART ──

export const INDIAMART_QUERY_TYPES: Record<string, string> = {
  W: 'Direct enquiry',
  B: 'Buy-lead',
  BL: 'Buy-lead',
  P: 'Phone call',
  V: 'Catalogue view',
  BIZ: 'Catalogue view',
  WA: 'WhatsApp enquiry',
};

const IST_MIN = 330;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');

/** IndiaMART pull API time format, in IST: 07-Dec-202109:00:00. */
export const formatIndiaMartTime = (d: Date) => {
  const t = new Date(d.getTime() + IST_MIN * 60_000);
  return (
    `${p2(t.getUTCDate())}-${MONTHS[t.getUTCMonth()]}-${t.getUTCFullYear()}` +
    `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}`
  );
};

/** "2024-04-10 11:17:14" (IST, as IndiaMART sends it) → UTC Date. */
export const parseIstDateTime = (v: unknown): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(v ?? '').trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - IST_MIN * 60_000;
  return Number.isNaN(ms) ? null : new Date(ms);
};

export const mapIndiaMart = (r: any): InboundLead | null => {
  if (!r || typeof r !== 'object') return null;
  const ref = clean(r.UNIQUE_QUERY_ID, 100);
  if (!ref) return null;
  const l = blankLead('INDIAMART');
  const phones = [r.SENDER_MOBILE, r.SENDER_PHONE, r.SENDER_MOBILE_ALT, r.SENDER_PHONE_ALT]
    .map(normalizePhone)
    .filter(Boolean) as string[];
  l.phone = phones[0] ?? null;
  l.alt_phone = phones.find((p) => phoneMatchKey(p) !== phoneMatchKey(l.phone)) ?? null;
  l.email = normalizeEmail(r.SENDER_EMAIL) ?? normalizeEmail(r.SENDER_EMAIL_ALT);
  l.name = clean(r.SENDER_NAME, 150) || 'IndiaMART Buyer';
  l.company_name = clean(r.SENDER_COMPANY, 200);
  l.address = clean(r.SENDER_ADDRESS, 500);
  l.city = clean(r.SENDER_CITY, 100);
  l.state = clean(r.SENDER_STATE, 100);
  l.pincode = normalizePincode(r.SENDER_PINCODE);
  l.country = clean(r.SENDER_COUNTRY_ISO, 60);
  l.requirement = clean(r.QUERY_PRODUCT_NAME, 300) || clean(r.SUBJECT, 300) || clean(r.QUERY_MCAT_NAME, 300);
  const type = clean(r.QUERY_TYPE, 10)?.toUpperCase() || null;
  const parts = [cleanText(r.QUERY_MESSAGE)];
  const subject = clean(r.SUBJECT, 300);
  if (subject && subject !== l.requirement && !parts[0]?.includes(subject)) parts.unshift(subject);
  const secs = Number(r.CALL_DURATION);
  if (type === 'P' && Number.isFinite(secs) && secs > 0) parts.push(`Call duration: ${Math.round(secs)} sec`);
  l.message = parts.filter(Boolean).join('\n\n').slice(0, 5000) || null;
  l.source_ref = ref;
  l.source_detail = type ? INDIAMART_QUERY_TYPES[type] || `Type ${type}` : null;
  l.received_at = parseIstDateTime(r.QUERY_TIME);
  return l;
};

/** The lead object inside an IndiaMART push (also tolerates the wrapper with `body`). */
export const indiaMartPushItems = (body: any): any[] => {
  const b = body && typeof body === 'object' && body.body && typeof body.body === 'object' ? body.body : body;
  const r = b?.RESPONSE;
  if (Array.isArray(r)) return r.filter((x) => x && typeof x === 'object' && x.UNIQUE_QUERY_ID);
  if (r && typeof r === 'object' && r.UNIQUE_QUERY_ID) return [r];
  if (b && typeof b === 'object' && b.UNIQUE_QUERY_ID) return [b];
  return [];
};

export type IndiaMartOutcome =
  | { kind: 'OK'; items: any[] }
  | { kind: 'NO_DATA' }
  | { kind: 'AUTH'; message: string }
  | { kind: 'RATE_LIMIT'; message: string }
  | { kind: 'ERROR'; message: string };

/** Reads the pull API's envelope: CODE 200 data, 204 none, 401 key, 429 too often. */
export const interpretIndiaMart = (body: any): IndiaMartOutcome => {
  if (!body || typeof body !== 'object') return { kind: 'ERROR', message: 'IndiaMART sent an unreadable response' };
  const code = Number(body.CODE);
  const msg = clean(body.MESSAGE, 280) || '';
  if (code === 200) return { kind: 'OK', items: Array.isArray(body.RESPONSE) ? body.RESPONSE : [] };
  if (code === 204) return { kind: 'NO_DATA' };
  if (code === 401) {
    return {
      kind: 'AUTH',
      message:
        msg ||
        'IndiaMART rejected the key. It may be wrong, replaced by a newer key, or expired after 7 days without use.',
    };
  }
  if (code === 429) return { kind: 'RATE_LIMIT', message: msg || 'IndiaMART allows one fetch every 5 minutes' };
  return { kind: 'ERROR', message: msg || `IndiaMART returned code ${Number.isFinite(code) ? code : '?'}` };
};

export const INDIAMART_MIN_GAP_MS = 5 * 60_000 + 15_000;
const INDIAMART_MAX_WINDOW_MS = 7 * 86_400_000 - 5 * 60_000;
const INDIAMART_OVERLAP_MS = 5 * 60_000;

/**
 * Next pull window: from just before where the last one ended (IndiaMART's
 * advice, duplicates are dropped by UNIQUE_QUERY_ID) to now, at most 7 days.
 * The first pull fetches the past week.
 */
export const indiaMartWindow = (cursor: Date | null, now: Date) => {
  const earliest = new Date(now.getTime() - INDIAMART_MAX_WINDOW_MS);
  const want = cursor ? new Date(new Date(cursor).getTime() - INDIAMART_OVERLAP_MS) : earliest;
  const start = want < earliest ? earliest : want;
  return { start, end: now, gap: !!cursor && want < earliest };
};

// ── Generic webhooks (website forms, Zapier / Make, Facebook & Google lead forms) ──

/** Lower-case letters and digits only: "Your-Name", "your_name" → "yourname". */
export const fieldKey = (k: string) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');

type Field =
  | 'name'
  | 'first_name'
  | 'last_name'
  | 'company_name'
  | 'phone'
  | 'alt_phone'
  | 'email'
  | 'gst_number'
  | 'address'
  | 'city'
  | 'state'
  | 'pincode'
  | 'country'
  | 'requirement'
  | 'message'
  | 'estimated_value'
  | 'source_ref'
  | 'source';

const ALIASES: Record<Field, string[]> = {
  name: ['name', 'fullname', 'yourname', 'contactname', 'contactperson', 'customername', 'clientname', 'person', 'buyername', 'sendername', 'leadname'],
  first_name: ['firstname', 'fname', 'givenname'],
  last_name: ['lastname', 'lname', 'surname', 'familyname'],
  company_name: ['company', 'companyname', 'organisation', 'organization', 'business', 'businessname', 'firm', 'firmname', 'sendercompany'],
  phone: ['phone', 'mobile', 'phonenumber', 'mobilenumber', 'mobileno', 'phoneno', 'contactnumber', 'contactno', 'whatsapp', 'whatsappnumber', 'tel', 'telephone', 'yourphone', 'yourmobile', 'cell', 'workphone', 'sendermobile'],
  alt_phone: ['altphone', 'alternatephone', 'alternatenumber', 'altmobile', 'landline', 'phone2', 'mobile2'],
  email: ['email', 'emailaddress', 'youremail', 'mail', 'emailid', 'workemail', 'senderemail'],
  gst_number: ['gst', 'gstin', 'gstno', 'gstnumber'],
  address: ['address', 'streetaddress', 'street', 'addressline1', 'fulladdress', 'senderaddress'],
  city: ['city', 'town', 'district', 'sendercity'],
  state: ['state', 'region', 'province', 'senderstate'],
  pincode: ['pincode', 'pin', 'zip', 'zipcode', 'postalcode', 'postcode', 'senderpincode'],
  country: ['country', 'countrycode', 'countryiso'],
  requirement: ['requirement', 'product', 'productname', 'service', 'interest', 'interestedin', 'lookingfor', 'enquiryfor', 'inquiryfor', 'subject', 'category', 'item', 'model'],
  message: ['message', 'yourmessage', 'comments', 'comment', 'enquiry', 'inquiry', 'details', 'description', 'notes', 'note', 'query', 'remarks', 'requirementdetails', 'msg'],
  estimated_value: ['budget', 'value', 'amount', 'estimatedvalue', 'dealvalue', 'expectedvalue'],
  source_ref: ['leadid', 'leadgenid', 'enquiryid', 'inquiryid', 'submissionid', 'entryid', 'responseid', 'uniqueid', 'externalid', 'refid', 'reference'],
  source: ['source', 'leadsource'],
};

const ALIAS_INDEX = new Map<string, Field>();
(Object.keys(ALIASES) as Field[]).forEach((f) => ALIASES[f].forEach((a) => ALIAS_INDEX.set(a, f)));

/** Keys that are plumbing, not lead data: never copied into the message. */
const IGNORED = /^(token|secret|key|apikey|googlekey|redirect|gotcha|honeypot|grecaptcharesponse|recaptcha|captcha|hcaptcharesponse|cfturnstileresponse|formid|formname|pageurl|pagetitle|referrer|referer|useragent|ip|isTest|istest|campaignid|adgroupid|creativeid|gclid|fbclid|timestamp|submittedat|action|wpcf7.*|wpnonce|nonce|csrf.*|utm.*|_.*)$/i;

/** Google Ads lead-form webhook: user_column_data entries keyed by column_id. */
const GOOGLE_COLUMNS: Record<string, Field> = {
  FULL_NAME: 'name',
  FIRST_NAME: 'first_name',
  LAST_NAME: 'last_name',
  PHONE_NUMBER: 'phone',
  WORK_PHONE: 'alt_phone',
  EMAIL: 'email',
  WORK_EMAIL: 'email',
  COMPANY_NAME: 'company_name',
  CITY: 'city',
  REGION: 'state',
  POSTAL_CODE: 'pincode',
  COUNTRY: 'country',
  STREET_ADDRESS: 'address',
};

/**
 * Flattens common webhook shapes into key → scalar pairs:
 * flat JSON or form fields, `{ data | fields | lead: {...} }` wrappers,
 * Elementor-style `fields[x] = { title, value }`, and `[{ name, value }]` lists.
 */
export const flattenPayload = (body: any): Array<[string, string]> => {
  const out: Array<[string, string]> = [];
  const push = (k: string, v: unknown) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      const scalars = v.filter((x) => x !== null && typeof x !== 'object');
      if (scalars.length) out.push([k, scalars.join(', ')]);
      return;
    }
    if (typeof v === 'object') return;
    const s = String(v).trim();
    if (s) out.push([k, s]);
  };
  const walk = (o: any, depth: number) => {
    if (!o || typeof o !== 'object' || depth > 3) return;
    if (Array.isArray(o)) {
      o.forEach((x) => {
        if (x && typeof x === 'object' && ('name' in x || 'label' in x || 'title' in x) && 'value' in x) {
          push(String(x.name ?? x.label ?? x.title), x.value);
        } else if (x && typeof x === 'object') walk(x, depth + 1);
      });
      return;
    }
    Object.entries(o).forEach(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('value' in (v as any) && typeof (v as any).value !== 'object') {
          push(String((v as any).title || (v as any).label || (v as any).name || k), (v as any).value);
        } else walk(v, depth + 1);
      } else if (Array.isArray(v) && v.some((x) => x && typeof x === 'object')) {
        walk(v, depth + 1);
      } else push(k, v);
    });
  };
  walk(body, 0);
  return out;
};

const humanLabel = (k: string) => {
  const s = String(k).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
};

/**
 * Maps any reasonable form / webhook payload to a lead. Unknown fields are
 * kept as "Label: value" lines in the message so nothing the buyer typed is lost.
 */
export const mapWebhook = (body: any, defaultSource: Source): InboundLead => {
  const l = blankLead(defaultSource);
  const got: Partial<Record<Field, string>> = {};
  const extra: string[] = [];

  // Google Ads lead form
  if (body && Array.isArray(body.user_column_data)) {
    body.user_column_data.forEach((c: any) => {
      const f = GOOGLE_COLUMNS[String(c?.column_id || '').toUpperCase()];
      const v = c?.string_value ?? c?.value;
      if (f && v != null && !got[f]) got[f] = String(v);
      else if (v != null && c?.column_name) extra.push(`${c.column_name}: ${v}`);
    });
    if (body.lead_id) got.source_ref = String(body.lead_id);
    if (defaultSource === 'WEBSITE') l.source = 'GOOGLE';
  }

  flattenPayload(body).forEach(([k, v]) => {
    const key = fieldKey(k);
    if (!key || key === 'usercolumndata') return;
    const f = ALIAS_INDEX.get(key);
    if (f) {
      if (!got[f]) got[f] = v;
      else if (f === 'phone' && !got.alt_phone) got.alt_phone = v;
      else if (f === 'message') got.message = `${got.message}\n${v}`;
      return;
    }
    if (IGNORED.test(key) || IGNORED.test(k)) {
      if (/^utmsource$|^utmcampaign$/.test(key) && !l.source_detail) l.source_detail = clean(v, 100);
      return;
    }
    if (v.length <= 1000) extra.push(`${humanLabel(k)}: ${v}`);
  });

  const full = clean(got.name, 150) || clean([got.first_name, got.last_name].filter(Boolean).join(' '), 150);
  l.phone = normalizePhone(got.phone);
  l.alt_phone = normalizePhone(got.alt_phone);
  if (!l.phone && l.alt_phone) [l.phone, l.alt_phone] = [l.alt_phone, null];
  if (l.alt_phone && phoneMatchKey(l.alt_phone) === phoneMatchKey(l.phone)) l.alt_phone = null;
  l.email = normalizeEmail(got.email);
  l.name = full || (l.email ? l.email.split('@')[0] : '') || 'Website visitor';
  l.company_name = clean(got.company_name, 200);
  l.gst_number = normalizeGstin(got.gst_number);
  l.address = clean(got.address, 500);
  l.city = clean(got.city, 100);
  l.state = clean(got.state, 100);
  l.pincode = normalizePincode(got.pincode);
  l.country = clean(got.country, 60);
  l.requirement = clean(got.requirement, 300);
  const msg = [cleanText(got.message), extra.length ? extra.join('\n') : null].filter(Boolean).join('\n\n');
  l.message = msg ? msg.slice(0, 5000) : null;
  l.estimated_value = parseAmount(got.estimated_value);
  l.source_ref = clean(got.source_ref, 100);
  const tag = got.source ? fieldKey(got.source).toUpperCase() : '';
  const bySource = SOURCES.find((s) => s.replace('_', '') === tag);
  if (bySource) l.source = bySource;
  else if (got.source && !l.source_detail) l.source_detail = clean(got.source, 100);
  return l;
};

/** True when a spam honeypot field ("_gotcha", "website_hp"…) was filled in. */
export const isHoneypotHit = (body: any) =>
  !!body &&
  typeof body === 'object' &&
  ['_gotcha', 'gotcha', '_honeypot', 'honeypot', 'website_hp', '_hp'].some(
    (k) => body[k] !== undefined && String(body[k]).trim() !== '',
  );

/** Short, safe JSON copy of a payload for the "original data" view. */
export const rawCopy = (body: any, max = 16_000): string | null => {
  try {
    const s = JSON.stringify(body);
    if (!s || s === '{}' || s === 'null') return null;
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return null;
  }
};

// ─── CSV import ─────────────────────────────────────────────────────────────

export const MAX_IMPORT_ROWS = 1000;

/** "Facebook", "walk-in", "IndiaMART" → a Source key (labels and keys both work). */
export const sourceFromText = (v: unknown): Source | null => {
  const k = fieldKey(String(v ?? ''));
  if (!k) return null;
  return (
    SOURCES.find((s) => fieldKey(s) === k) ??
    SOURCES.find((s) => fieldKey(SOURCE_LABEL[s]) === k) ??
    (k.includes('facebook') || k.includes('instagram') ? 'FACEBOOK' : null) ??
    (k.includes('google') ? 'GOOGLE' : null) ??
    (k.includes('website') || k === 'web' ? 'WEBSITE' : null)
  );
};

/** One CSV row (already mapped to our column names by the browser) → lead. */
export const mapImportRow = (row: Record<string, any>, defaultSource: Source): InboundLead => {
  const l = blankLead(sourceFromText(row.source) ?? defaultSource);
  l.phone = normalizePhone(row.phone);
  l.alt_phone = normalizePhone(row.alt_phone);
  if (!l.phone && l.alt_phone) [l.phone, l.alt_phone] = [l.alt_phone, null];
  if (l.alt_phone && phoneMatchKey(l.alt_phone) === phoneMatchKey(l.phone)) l.alt_phone = null;
  l.email = normalizeEmail(row.email);
  l.company_name = clean(row.company_name, 200);
  l.name = clean(row.name, 150) || l.company_name || (l.email ? l.email.split('@')[0] : '') || 'Unnamed lead';
  l.gst_number = normalizeGstin(row.gst_number);
  l.address = clean(row.address, 500);
  l.city = clean(row.city, 100);
  l.state = clean(row.state, 100);
  l.pincode = normalizePincode(row.pincode);
  l.country = clean(row.country, 60);
  l.requirement = clean(row.requirement, 300);
  l.message = cleanText(row.message);
  l.estimated_value = parseAmount(row.estimated_value);
  return l;
};
