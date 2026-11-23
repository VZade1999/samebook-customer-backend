import { isEmail, maskAccount, textOf } from '../ai-agent.rules';
import { type AiTool, type ToolContext, ToolRefusal, fromResult } from './types';

const FIELDS: Record<string, { label: string; max: number }> = {
  name: { label: 'Name', max: 150 },
  legal_name: { label: 'Legal name', max: 200 },
  gst_no: { label: 'GST number', max: 15 },
  website: { label: 'Website', max: 200 },
  industry: { label: 'Industry', max: 100 },
  primary_email: { label: 'Email', max: 150 },
  primary_phone: { label: 'Phone', max: 20 },
  default_terms_conditions: { label: 'Default terms', max: 4000 },
};

async function company(ctx: ToolContext) {
  const r = fromResult(await ctx.s.company.getCompanyById(ctx.user.company_id, { companyId: ctx.user.company_id } as any), 'Company not found');
  if (!r.ok || !r.data) throw new ToolRefusal("Couldn't read your company details");
  return typeof r.data.toJSON === 'function' ? r.data.toJSON() : r.data;
}

/** What may change, cleaned; GSTIN and email checked like the company page. */
function changes(args: Record<string, any>) {
  const out: Record<string, string> = {};
  for (const [k, f] of Object.entries(FIELDS)) {
    if (args[k] === undefined) continue;
    const v = k === 'default_terms_conditions' ? String(args[k] ?? '').trim().slice(0, f.max) : textOf(args[k], f.max) || '';
    out[k] = k === 'gst_no' ? v.toUpperCase() : v;
  }
  if (out.gst_no && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(out.gst_no)) throw new ToolRefusal(`"${out.gst_no}" isn't a valid GSTIN`);
  if (out.primary_email && !isEmail(out.primary_email)) throw new ToolRefusal(`"${out.primary_email}" isn't an email address`);
  if (out.name === '') throw new ToolRefusal("The company name can't be empty");
  if (!Object.keys(out).length) throw new ToolRefusal('Nothing to change — say what should change');
  return out;
}

export const companyTools: AiTool[] = [
  {
    name: 'company_details',
    group: 'Company',
    label: 'Your company details',
    description: "Your company's name, GSTIN, contact details, default terms, addresses, branches and bank accounts (account numbers masked).",
    parameters: { type: 'object', properties: {} },
    permissions: ['companies.view'],
    kind: 'read',
    async run(_args, ctx) {
      const c = await company(ctx);
      return {
        ok: true,
        record: { type: 'company', id: ctx.user.company_id, label: c.name || 'Your company' },
        data: {
          name: c.name,
          legal_name: c.legal_name || undefined,
          gst_no: c.gst_no || undefined,
          website: c.website || undefined,
          industry: c.industry || undefined,
          email: c.primary_email || undefined,
          phone: c.primary_phone || undefined,
          default_terms: c.default_terms_conditions ? String(c.default_terms_conditions).slice(0, 600) : undefined,
          addresses: (c.addresses || []).map((a: any) => [a.address_line_1, a.city, a.state, a.postal_code].filter(Boolean).join(', ')).filter(Boolean),
          branches: (c.locations || []).map((l: any) => ({ name: l.name || l.location_name, gst_no: l.gst_no || undefined })),
          bank_accounts: (c.bank_accounts || []).map((b: any) => ({
            id: b.id,
            bank: b.bank_name,
            account: maskAccount(b.account_number),
            ifsc: b.ifsc_code || undefined,
            default: Number(b.is_default) === 1 || undefined,
          })),
          link: '/app/companies',
        },
      };
    },
  },
  {
    name: 'update_company',
    group: 'Company',
    label: 'Edit company details',
    description: "Change your company's name, legal name, GSTIN, website, industry, email, phone or default terms. Needs the person to press Confirm.",
    parameters: {
      type: 'object',
      properties: Object.fromEntries(Object.keys(FIELDS).map((k) => [k, { type: 'string' }])),
    },
    permissions: ['companies.edit'],
    kind: 'confirm',
    async prepare(args, ctx) {
      const next = changes(args);
      const now = await company(ctx);
      const lines = Object.entries(next).map(([k, v]) => {
        const before = String(now[k] ?? '').trim();
        const show = (s: string) => (s ? (s.length > 60 ? `${s.slice(0, 57)}…` : s) : 'empty');
        return `${FIELDS[k].label}: ${show(before)} → ${show(v)}`;
      });
      return {
        summary: `Change your company's ${Object.keys(next).map((k) => FIELDS[k].label.toLowerCase()).join(', ')}`,
        details: lines,
        args: next,
        record: { type: 'company', id: ctx.user.company_id, label: now.name || 'Your company' },
      };
    },
    async run(args, ctx) {
      const next = changes(args);
      const r = fromResult(await ctx.s.company.updateCompany(ctx.user.company_id, next as any, { companyId: ctx.user.company_id } as any), 'Could not update the company');
      return { ok: r.ok, message: r.ok ? 'Company details updated' : r.message, data: { ok: r.ok, message: r.message }, record: { type: 'company', id: ctx.user.company_id, label: 'Company' } };
    },
  },
];
