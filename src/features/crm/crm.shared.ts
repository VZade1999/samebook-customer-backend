import { CrmActor, LeadCapabilities, followUpState, leadCapabilities, leadKey } from './crm.rules';

export interface CrmRequester {
  userId: number;
  companyId: number;
  permissions: string[];
}

export type Result<T = any> =
  | { success: true; message: string; data: T }
  | { success: false; message: string; status: number; data?: any };

export const ok = <T>(message: string, data: T): Result<T> => ({ success: true, message, data });
export const fail = (message: string, status = 400, data?: any): Result => ({ success: false, message, status, data });

export const USER_ATTRS = ['id', 'first_name', 'last_name', 'email'];
export const userName = (u: any) => (u ? [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email : null);
export const userRef = (u: any) => (u ? { id: Number(u.id), name: userName(u) } : null);

export const actorOf = (r: CrmRequester): CrmActor => ({
  userId: Number(r.userId),
  isManager: r.permissions.includes('crm.manage'),
});
export const canCreateLeads = (r: CrmRequester) =>
  r.permissions.includes('crm.create') || r.permissions.includes('crm.manage');

const num = (v: any) => (v === null || v === undefined ? null : Number(v));

export interface SerializeContext {
  actor: CrmActor;
  now: Date;
  endOfToday: Date;
}

/** API shape of a lead (list, board and detail share it). */
export const serializeLead = (l: any, ctx: SerializeContext, opts: { full?: boolean } = {}) => {
  const can: LeadCapabilities = leadCapabilities(l, ctx.actor);
  const msg: string | null = l.message ?? null;
  return {
    id: Number(l.id),
    key: leadKey(l.lead_number),
    name: l.name,
    company_name: l.company_name ?? null,
    phone: l.phone ?? null,
    alt_phone: l.alt_phone ?? null,
    email: l.email ?? null,
    gst_number: l.gst_number ?? null,
    address: l.address ?? null,
    city: l.city ?? null,
    state: l.state ?? null,
    pincode: l.pincode ?? null,
    country: l.country ?? null,
    requirement: l.requirement ?? null,
    message: opts.full ? msg : msg && msg.length > 180 ? `${msg.slice(0, 180)}…` : msg,
    estimated_value: num(l.estimated_value),
    source: l.source,
    source_detail: l.source_detail ?? null,
    integration: l.integration ? { id: Number(l.integration.id), name: l.integration.name, type: l.integration.type } : null,
    stage: l.stage,
    rating: l.rating ?? null,
    owner: userRef(l.owner),
    creator: userRef(l.creator),
    next_follow_up_at: l.next_follow_up_at ?? null,
    follow_up_note: l.follow_up_note ?? null,
    follow_up_state: followUpState(l, ctx.now, ctx.endOfToday),
    last_activity_at: l.last_activity_at ?? null,
    first_response_at: l.first_response_at ?? null,
    received_at: l.received_at ?? l.created_at ?? null,
    won_at: l.won_at ?? null,
    lost_at: l.lost_at ?? null,
    lost_reason: l.lost_reason ?? null,
    customer: l.customer_id
      ? { id: Number(l.customer_id), name: l.customer?.display_name ?? null, company_name: l.customer?.company_name ?? null }
      : null,
    converted_at: l.converted_at ?? null,
    enquiry_count: Number(l.enquiry_count || 1),
    created_at: l.created_at,
    updated_at: l.updated_at,
    can,
  };
};
