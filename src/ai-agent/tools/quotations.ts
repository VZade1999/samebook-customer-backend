import { isIsoDate } from '../../dashboard/dashboard.rules';
import { CLOSE_REASONS, closeBlocker, parseClose } from '../../quotations/quotation-insights.rules';
import { idOf, inr, intIn, recordLink, textOf } from '../ai-agent.rules';
import { type AiTool, type ToolContext, ToolRefusal, fromResult } from './types';

const STAGES = ['draft', 'sent', 'approved', 'invoiced', 'rejected', 'expired', 'open', 'expiring', 'lapsed'];
const REASON_KEYS = [...new Set([...CLOSE_REASONS.REJECTED, ...CLOSE_REASONS.EXPIRED].map((r) => r.key))];
/** GST used when the items don't say (the rate most of your quotations use). */
const DEFAULT_GST = 18;

const itemSchema = {
  type: 'object',
  properties: {
    product_name: { type: 'string', description: 'Exact product name from find_products when it exists' },
    qty: { type: 'number' },
    rate: { type: 'number', description: 'Price per unit before GST' },
    unit: { type: 'string' },
    hsn_code: { type: 'string' },
    discount_percent: { type: 'number' },
  },
  required: ['product_name', 'qty', 'rate'],
};

const quotationId = (args: Record<string, any>) => {
  const id = idOf(args.id);
  if (!id) throw new ToolRefusal('Which quotation? Find it first to get its id');
  return id;
};

async function brief(ctx: ToolContext, id: number) {
  const q = await ctx.s.lookup.quotationBrief(ctx.user.company_id, id);
  if (!q) throw new ToolRefusal('That quotation was not found');
  return q;
}

const label = (q: { number: string; customer: string; total: number }) => `${q.number} (${q.customer}, ${inr(q.total)})`;

/** Lines as the quotation editor sends them; refuses anything the editor wouldn't accept. */
function items(raw: unknown) {
  if (!Array.isArray(raw) || !raw.length) throw new ToolRefusal('Add at least one item (product, quantity and rate)');
  if (raw.length > 100) throw new ToolRefusal('At most 100 items on one quotation');
  return raw.map((it: any, i: number) => {
    const product_name = textOf(it?.product_name, 250);
    if (!product_name) throw new ToolRefusal(`Item ${i + 1} needs a product name`);
    const qty = Number(it?.qty);
    const rate = Number(it?.rate);
    if (!Number.isFinite(qty) || qty <= 0) throw new ToolRefusal(`${product_name}: the quantity must be more than 0`);
    if (!Number.isFinite(rate) || rate < 0) throw new ToolRefusal(`${product_name}: the rate can't be below 0`);
    const discount = it?.discount_percent === undefined || it?.discount_percent === null ? undefined : Number(it.discount_percent);
    if (discount !== undefined && (!Number.isFinite(discount) || discount < 0 || discount > 100)) {
      throw new ToolRefusal(`${product_name}: the discount must be 0–100%`);
    }
    return {
      product_name,
      qty: Math.round(qty * 1000) / 1000,
      rate: Math.round(rate * 100) / 100,
      unit: textOf(it?.unit, 20) || undefined,
      hsn_code: textOf(it?.hsn_code, 20) || undefined,
      discount_percent: discount,
    };
  });
}

/** The GST rate for the document: as asked, else the products' own rate when they agree, else 18%. */
async function gstFor(ctx: ToolContext, lines: { product_name: string }[], asked: unknown) {
  if (asked !== undefined && asked !== null && asked !== '') {
    const n = Number(asked);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new ToolRefusal(`${asked}% isn't a GST rate`);
    return n;
  }
  const rates = await ctx.s.lookup.productGstRates(
    ctx.user.company_id,
    lines.map((l) => l.product_name),
  );
  return rates.length === 1 ? rates[0] : DEFAULT_GST;
}

/** The split the server keeps (it zeroes CGST+SGST or IGST by the buyer's state). */
const split = (gst: number) => ({ cgst_percent: gst / 2, sgst_percent: gst / 2, igst_percent: gst });

function bankSnapshot(account: any): string {
  return JSON.stringify({
    bank_id: account.id,
    bank_name: account.bank_name,
    account_holder_name: account.account_holder_name,
    account_number: account.account_number,
    ifsc_code: account.ifsc_code,
    branch_name: account.branch_name,
    branch_address: account.branch_address,
    account_type: account.account_type,
    is_default: account.is_default,
  });
}

export const quotationTools: AiTool[] = [
  {
    name: 'find_quotations',
    group: 'Quotations',
    label: 'Find quotations',
    description:
      'Search quotations by number, customer, contact or PO. stage: draft, sent, approved, invoiced, rejected, expired, open (draft+sent+approved), expiring (valid ≤7 more days), lapsed (validity passed, still open).',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        stage: { type: 'string', enum: STAGES },
        customer_id: { type: 'number' },
        from: { type: 'string', description: 'Quotation date from (YYYY-MM-DD)' },
        to: { type: 'string', description: 'Quotation date to (YYYY-MM-DD)' },
        limit: { type: 'number', description: 'Rows (default 10, max 25)' },
      },
    },
    permissions: ['quotations.view'],
    kind: 'read',
    async run(args, ctx) {
      const d = await ctx.s.lookup.quotations(ctx.user.company_id, {
        search: textOf(args.search, 80),
        stage: STAGES.includes(args.stage) ? args.stage : null,
        customer_id: idOf(args.customer_id),
        from: isIsoDate(args.from) ? args.from : null,
        to: isIsoDate(args.to) ? args.to : null,
        limit: intIn(args.limit, 1, 25, 10),
        today: ctx.today,
        tz: ctx.tz,
      });
      return { ok: true, data: { ...d, quotations: d.quotations.map((x) => ({ ...x, link: recordLink('quotation', x.id) })) } };
    },
  },
  {
    name: 'quotation_details',
    group: 'Quotations',
    label: 'Quotation details',
    description: "One quotation's customer, items, totals, PO, status and its challans and invoices.",
    parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    permissions: ['quotations.view'],
    kind: 'read',
    async run(args, ctx) {
      const id = quotationId(args);
      const q = await ctx.s.lookup.quotation(ctx.user.company_id, id, ctx.tz);
      if (!q) throw new ToolRefusal('That quotation was not found');
      return { ok: true, record: { type: 'quotation', id, label: q.number }, data: { ...q, link: recordLink('quotation', id) } };
    },
  },
  {
    name: 'create_quotation',
    group: 'Quotations',
    label: 'Make quotations',
    description:
      'Create a DRAFT quotation. Find the customer first (customer_id) and use exact product names and rates from find_products when they exist. GST: pass gst_percent only if the person says; otherwise the products’ own rate (or 18%) is used. Contact, address and bank account fill in by themselves; if the reply lists options, ask the person which one and call again with that id.',
    parameters: {
      type: 'object',
      properties: {
        customer_id: { type: 'number' },
        items: { type: 'array', items: itemSchema },
        gst_percent: { type: 'number', description: 'Total GST % for the document, e.g. 18' },
        discount_amount: { type: 'number', description: 'Flat discount off the subtotal (₹)' },
        transport_charges: { type: 'number' },
        notes: { type: 'string' },
        quotation_date: { type: 'string', description: 'YYYY-MM-DD (default today)' },
        valid_till: { type: 'string', description: 'YYYY-MM-DD' },
        contact_person_id: { type: 'number' },
        billing_address_id: { type: 'number' },
        shipping_address_id: { type: 'number' },
        bank_account_id: { type: 'number' },
      },
      required: ['customer_id', 'items'],
    },
    permissions: ['quotations.create'],
    kind: 'write',
    async run(args, ctx) {
      const customerId = idOf(args.customer_id);
      if (!customerId) throw new ToolRefusal('Which customer is it for? Find them first');
      const lines = items(args.items);
      const details = fromResult(await ctx.s.customers.getCustomerDetails(customerId, ctx.user), 'Customer not found');
      if (!details.ok || !details.data) throw new ToolRefusal('That customer was not found');
      const c = typeof details.data.toJSON === 'function' ? details.data.toJSON() : details.data;
      const contacts: any[] = c.contacts || [];
      const addresses: any[] = c.addresses || [];

      // The same choices the editor makes: one option (or the primary) is used; several → ask.
      let contactId = idOf(args.contact_person_id);
      if (!contactId && contacts.length) {
        const primary = contacts.filter((x) => Number(x.is_primary) === 1);
        if (contacts.length === 1 || primary.length === 1) contactId = (contacts.length === 1 ? contacts[0] : primary[0]).id;
        else
          return {
            ok: false,
            message: 'Pick a contact person',
            data: { needs_choice: 'contact_person_id', options: contacts.map((x) => ({ id: x.id, name: [x.first_name, x.last_name].filter(Boolean).join(' '), phone: x.phone })) },
          };
      }
      let billingId = idOf(args.billing_address_id);
      let shippingId = idOf(args.shipping_address_id);
      if ((!billingId || !shippingId) && addresses.length) {
        const primary = addresses.filter((x) => Number(x.is_primary) === 1);
        const pick = addresses.length === 1 ? addresses[0] : primary.length === 1 ? primary[0] : null;
        if (!pick)
          return {
            ok: false,
            message: 'Pick the billing / shipping address',
            data: {
              needs_choice: 'billing_address_id',
              options: addresses.map((x) => ({ id: x.id, address: [x.label || x.address_type, x.address_line_1, x.city, x.state].filter(Boolean).join(', ') })),
            },
          };
        billingId = billingId || pick.id;
        shippingId = shippingId || pick.id;
      }

      const company = fromResult(await ctx.s.company.getCompanyById(ctx.user.company_id, { companyId: ctx.user.company_id } as any), 'Company not found');
      const banks: any[] = ((company.data?.toJSON ? company.data.toJSON() : company.data)?.bank_accounts || []).filter((b: any) => Number(b.is_active ?? 1) !== 0);
      let bank: any = null;
      const askedBank = idOf(args.bank_account_id);
      if (askedBank) {
        bank = banks.find((b) => Number(b.id) === askedBank);
        if (!bank) throw new ToolRefusal('That bank account was not found');
      } else if (banks.length === 1) bank = banks[0];
      else if (banks.length > 1) {
        bank = banks.find((b) => Number(b.is_default) === 1) || null;
        if (!bank)
          return {
            ok: false,
            message: 'Pick the bank account to print',
            data: { needs_choice: 'bank_account_id', options: banks.map((b) => ({ id: b.id, bank: b.bank_name, account: `••••${String(b.account_number || '').slice(-4)}` })) },
          };
      }

      const gst = await gstFor(ctx, lines, args.gst_percent);
      const r = fromResult(
        await ctx.s.quotations.createQuotation({
          customer_id: customerId,
          items: lines,
          ...split(gst),
          discount_amount: args.discount_amount !== undefined ? Math.max(0, Number(args.discount_amount) || 0) : undefined,
          transport_charges: args.transport_charges !== undefined ? Math.max(0, Number(args.transport_charges) || 0) : undefined,
          notes: textOf(args.notes, 2000) || undefined,
          quotation_date: isIsoDate(args.quotation_date) ? args.quotation_date : ctx.today,
          validity_date: isIsoDate(args.valid_till) ? args.valid_till : undefined,
          contact_person_id: contactId || undefined,
          billing_address_id: billingId || undefined,
          shipping_address_id: shippingId || undefined,
          ...(bank ? { payment_details_snapshot: bankSnapshot(bank) } : {}),
          company_id: ctx.user.company_id,
          user_id: ctx.user.user_id,
        } as any),
        'Could not create the quotation',
      );
      if (!r.ok) return { ok: false, message: r.message, data: { error: r.message } };
      const made = typeof r.data?.toJSON === 'function' ? r.data.toJSON() : r.data;
      const id = Number(made?.id);
      const number = made?.quotation_number || `#${id}`;
      return {
        ok: true,
        message: `Made quotation ${number} for ${c.display_name} (${inr(made?.grand_total)})`,
        record: { type: 'quotation', id, label: number },
        data: { id, number, status: 'DRAFT', gst_percent: gst, grand_total: Number(made?.grand_total) || undefined, link: recordLink('quotation', id) },
      };
    },
  },
  {
    name: 'update_quotation',
    group: 'Quotations',
    label: 'Edit quotations',
    description:
      'Change a quotation. items REPLACES all lines, so get quotation_details first and send the full list. Only pass what changes.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        items: { type: 'array', items: itemSchema },
        discount_amount: { type: 'number' },
        transport_charges: { type: 'number' },
        notes: { type: 'string' },
        valid_till: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['id'],
    },
    permissions: ['quotations.edit'],
    kind: 'write',
    async run(args, ctx) {
      const id = quotationId(args);
      const q = await brief(ctx, id);
      if (q.invoiced) throw new ToolRefusal(`${q.number} is already invoiced, so it can't be changed`);
      const data: any = { user_id: ctx.user.user_id };
      if (args.items !== undefined) data.items = items(args.items);
      if (args.discount_amount !== undefined) data.discount_amount = Math.max(0, Number(args.discount_amount) || 0);
      if (args.transport_charges !== undefined) data.transport_charges = Math.max(0, Number(args.transport_charges) || 0);
      if (args.notes !== undefined) data.notes = textOf(args.notes, 2000) || '';
      if (isIsoDate(args.valid_till)) data.validity_date = args.valid_till;
      if (Object.keys(data).length === 1) throw new ToolRefusal('Nothing to change — say what should change');
      const r = fromResult(await ctx.s.quotations.updateQuotation(id, ctx.user.company_id, data), 'Could not update the quotation');
      return {
        ok: r.ok,
        message: r.ok ? `Updated quotation ${q.number}` : r.message,
        record: r.ok ? { type: 'quotation', id, label: q.number } : undefined,
        data: r.ok ? { id, number: q.number, updated: Object.keys(data).filter((k) => k !== 'user_id'), link: recordLink('quotation', id) } : { error: r.message },
      };
    },
  },
  {
    name: 'send_quotation',
    group: 'Quotations',
    label: 'Mark quotations as sent',
    description: 'Mark a draft quotation as sent to the customer. Needs the person to press Confirm.',
    parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    permissions: ['quotations.send'],
    kind: 'confirm',
    async prepare(args, ctx) {
      const q = await brief(ctx, quotationId(args));
      if (q.invoiced || !['DRAFT', 'SENT', ''].includes(q.status)) throw new ToolRefusal(`${q.number} is ${q.stage}, so it can't be sent again`);
      return {
        summary: `Mark quotation ${q.number} as sent to ${q.customer}`,
        details: [`Total ${inr(q.total)}`, q.status === 'SENT' ? 'It was sent before — this records it as sent again.' : 'Its status changes from draft to sent.'],
        args: { id: q.id },
        record: { type: 'quotation', id: q.id, label: q.number },
      };
    },
    async run(args, ctx) {
      const q = await brief(ctx, quotationId(args));
      const r = fromResult(await ctx.s.quotations.sendQuotation(q.id, ctx.user.company_id, ctx.user.user_id), 'Could not send the quotation');
      return { ok: r.ok, message: r.ok ? `Quotation ${q.number} marked as sent` : r.message, data: { ok: r.ok, message: r.message }, record: { type: 'quotation', id: q.id, label: q.number } };
    },
  },
  {
    name: 'approve_quotation',
    group: 'Quotations',
    label: 'Approve quotations',
    description: "Record that the customer accepted a quotation, with their PO number and date when they gave one (required for customers who always send a PO). Needs the person to press Confirm.",
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        po_number: { type: 'string' },
        po_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['id'],
    },
    permissions: ['quotations.send'],
    kind: 'confirm',
    async prepare(args, ctx) {
      const q = await brief(ctx, quotationId(args));
      if (q.invoiced || !['DRAFT', 'SENT', ''].includes(q.status)) throw new ToolRefusal(`${q.number} is ${q.stage}, so it can't be approved`);
      const po = textOf(args.po_number, 40);
      const poDate = isIsoDate(args.po_date) ? args.po_date : null;
      if (q.po_required && !po) throw new ToolRefusal(`${q.customer} always sends a purchase order — ask for the PO number (and date) first`);
      if (poDate && poDate > ctx.today) throw new ToolRefusal("The PO date can't be in the future");
      return {
        summary: `Approve quotation ${label(q)}`,
        details: [po ? `Customer PO ${po}${poDate ? ` dated ${poDate}` : ''}` : 'No customer PO', 'It then shows as approved, ready for a challan or invoice.'],
        args: { id: q.id, ...(po ? { po_number: po } : {}), ...(poDate ? { po_date: poDate } : {}) },
        record: { type: 'quotation', id: q.id, label: q.number },
      };
    },
    async run(args, ctx) {
      const q = await brief(ctx, quotationId(args));
      const r = fromResult(
        await ctx.s.quotations.approveQuotation(q.id, ctx.user.company_id, ctx.user.user_id, {
          customer_po_number: textOf(args.po_number, 40) || undefined,
          customer_po_date: isIsoDate(args.po_date) ? args.po_date : undefined,
        }),
        'Could not approve the quotation',
      );
      return { ok: r.ok, message: r.ok ? `Quotation ${q.number} approved` : r.message, data: { ok: r.ok, message: r.message }, record: { type: 'quotation', id: q.id, label: q.number } };
    },
  },
  {
    name: 'close_quotation',
    group: 'Quotations',
    label: 'Close quotations as lost or expired',
    description: `Close an open quotation: outcome REJECTED (customer said no; reasons ${CLOSE_REASONS.REJECTED.map((r) => r.key).join(', ')}) or EXPIRED (reasons ${CLOSE_REASONS.EXPIRED.map((r) => r.key).join(', ')}). OTHER needs a remark. Needs the person to press Confirm.`,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        outcome: { type: 'string', enum: ['REJECTED', 'EXPIRED'] },
        reason: { type: 'string', enum: REASON_KEYS },
        remark: { type: 'string', description: "The customer's words, if any" },
      },
      required: ['id', 'outcome', 'reason'],
    },
    permissions: ['quotations.edit'],
    kind: 'confirm',
    async prepare(args, ctx) {
      const q = await brief(ctx, quotationId(args));
      const blocked = closeBlocker({ status: q.status, has_invoice: q.invoiced ? 1 : 0 });
      if (blocked) throw new ToolRefusal(blocked);
      const parsed = parseClose({ outcome: args.outcome, reason: args.reason, remark: args.remark });
      if (!parsed.ok) throw new ToolRefusal(parsed.message);
      const reasonLabel = CLOSE_REASONS[parsed.outcome].find((r) => r.key === parsed.reason)?.label || parsed.reason;
      return {
        summary: `Close quotation ${label(q)} as ${parsed.outcome === 'REJECTED' ? 'lost' : 'expired'}`,
        details: [`Reason: ${reasonLabel}`, ...(parsed.remark ? [`Remark: ${parsed.remark}`] : []), 'It can be reopened later.'],
        args: { id: q.id, outcome: parsed.outcome, reason: parsed.reason, ...(parsed.remark ? { remark: parsed.remark } : {}) },
        record: { type: 'quotation', id: q.id, label: q.number },
      };
    },
    async run(args, ctx) {
      const q = await brief(ctx, quotationId(args));
      const r = fromResult(
        await ctx.s.quotations.closeQuotation(q.id, ctx.user.company_id, ctx.user.user_id, { outcome: args.outcome, reason: args.reason, remark: args.remark }),
        'Could not close the quotation',
      );
      return { ok: r.ok, message: r.ok ? `Quotation ${q.number} closed` : r.message, data: { ok: r.ok, message: r.message }, record: { type: 'quotation', id: q.id, label: q.number } };
    },
  },
  {
    name: 'delete_quotation',
    group: 'Quotations',
    label: 'Delete quotations',
    description: 'Delete a quotation that has no invoice. Needs the person to press Confirm.',
    parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    permissions: ['quotations.delete'],
    kind: 'confirm',
    async prepare(args, ctx) {
      const q = await brief(ctx, quotationId(args));
      if (q.invoiced) throw new ToolRefusal(`${q.number} has an invoice, so it can't be deleted`);
      return {
        summary: `Delete quotation ${label(q)}`,
        details: ['It disappears from your quotations; its history is kept.'],
        args: { id: q.id },
        record: { type: 'quotation', id: q.id, label: q.number },
      };
    },
    async run(args, ctx) {
      const q = await brief(ctx, quotationId(args));
      if (q.invoiced) throw new ToolRefusal(`${q.number} has an invoice, so it can't be deleted`);
      const r = fromResult(await ctx.s.quotations.deleteQuotation(q.id, ctx.user.company_id, ctx.user.user_id), 'Could not delete the quotation');
      return { ok: r.ok, message: r.ok ? `Deleted quotation ${q.number}` : r.message, data: { ok: r.ok, message: r.message } };
    },
  },
];
