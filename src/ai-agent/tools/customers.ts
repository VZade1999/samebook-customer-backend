import { idOf, indianPhone, intIn, isEmail, recordLink, textOf } from '../ai-agent.rules';
import { type AiTool, type ToolContext, ToolRefusal, fromResult } from './types';

const FILTERS = ['all', 'due', 'billed', 'never', 'new', 'incomplete'];
const SORTS = ['recent', 'name', 'billed', 'due', 'activity'];

const ADDRESS_FIELDS = ['address_line_1', 'address_line_2', 'city', 'state', 'country', 'postal_code'] as const;

/** Phone and email as the customer forms accept them, or a plain refusal. */
function contactChecks(args: Record<string, any>) {
  const phone = args.phone !== undefined ? indianPhone(args.phone) : undefined;
  if (args.phone !== undefined && !phone) throw new ToolRefusal('The phone must be a 10-digit Indian mobile number (starting with 6–9)');
  const email = args.email !== undefined ? textOf(args.email, 120) : undefined;
  if (email && !isEmail(email)) throw new ToolRefusal(`"${email}" doesn't look like an email address`);
  return { phone: phone ?? undefined, email: email ?? undefined };
}

const customerId = (args: Record<string, any>) => {
  const id = idOf(args.id);
  if (!id) throw new ToolRefusal('Which customer? Find them first to get their id');
  return id;
};

async function mustFind(ctx: ToolContext, id: number) {
  const c = await ctx.s.lookup.customerBrief(ctx.user.company_id, id);
  if (!c) throw new ToolRefusal('That customer was not found');
  return c;
}

export const customerTools: AiTool[] = [
  {
    name: 'find_customers',
    group: 'Customers',
    label: 'Find customers',
    description:
      'Search customers by name, company, GST number, contact, phone, email or city. Filters: due (owes money), billed, never (never billed), new, incomplete (missing contact). Returns contact, place, document counts and dues (dues only when money is visible).',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Words to look for' },
        filter: { type: 'string', enum: FILTERS },
        sort: { type: 'string', enum: SORTS, description: 'Default recent' },
        limit: { type: 'number', description: 'Rows to return (default 10, max 25)' },
      },
    },
    permissions: ['customers.view'],
    kind: 'read',
    async run(args, ctx) {
      const d = await ctx.s.directory.directory(ctx.user.company_id, ctx.user.permissions, {
        search: textOf(args.search, 100) || '',
        filter: FILTERS.includes(args.filter) ? args.filter : 'all',
        sort: SORTS.includes(args.sort) ? args.sort : 'recent',
        limit: intIn(args.limit, 1, 25, 10),
        page: 1,
      });
      return {
        ok: true,
        data: {
          total: d.pagination.total,
          money_visible: d.access.money,
          customers: d.customers.map((c: any) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            contact: c.contact?.name || undefined,
            phone: c.contact?.phone || c.phone || undefined,
            email: c.contact?.email || c.email || undefined,
            place: [c.city, c.state].filter(Boolean).join(', ') || undefined,
            gst: c.gst_number || undefined,
            quotations: c.quotations,
            invoices: c.invoices,
            ...(d.access.money ? { billed: c.billed, due: c.due } : {}),
            last_activity: c.last_activity || undefined,
            link: recordLink('customer', c.id),
          })),
        },
      };
    },
  },
  {
    name: 'customer_details',
    group: 'Customers',
    label: 'Customer details and recent documents',
    description: "One customer's contacts, addresses, billing summary (money only when visible) and recent quotations, challans and invoices.",
    parameters: { type: 'object', properties: { id: { type: 'number', description: 'Customer id' } }, required: ['id'] },
    permissions: ['customers.view'],
    kind: 'read',
    async run(args, ctx) {
      const id = customerId(args);
      const r = fromResult(await ctx.s.customers.getCustomerDetails(id, ctx.user), 'Customer not found');
      if (!r.ok || !r.data) throw new ToolRefusal('That customer was not found');
      const c = typeof r.data.toJSON === 'function' ? r.data.toJSON() : r.data;
      const a: any = await ctx.s.directory.activity(ctx.user.company_id, id, ctx.user.permissions);
      const name = c.display_name || c.company_name || `Customer #${id}`;
      return {
        ok: true,
        record: { type: 'customer', id, label: name },
        data: {
          id,
          name,
          type: c.customer_type,
          company_name: c.company_name || undefined,
          gst: c.gst_number || undefined,
          po_required: Number(c.po_required) === 1,
          contacts: (c.contacts || []).map((x: any) => ({
            id: x.id,
            name: [x.first_name, x.last_name].filter(Boolean).join(' '),
            phone: x.phone || undefined,
            email: x.email || undefined,
            designation: x.designation || undefined,
            primary: Number(x.is_primary) === 1,
          })),
          addresses: (c.addresses || []).map((x: any) => ({
            id: x.id,
            type: x.address_type,
            label: x.label || undefined,
            address: [x.address_line_1, x.address_line_2, x.city, x.state, x.postal_code].filter(Boolean).join(', '),
            gst: x.gst_number || undefined,
            primary: Number(x.is_primary) === 1,
          })),
          money_visible: !!a?.access?.money,
          invoices: a?.invoices || undefined,
          quotations: a?.quotations || undefined,
          challans: a?.challans || undefined,
          link: recordLink('customer', id),
        },
      };
    },
  },
  {
    name: 'create_customer',
    group: 'Customers',
    label: 'Add customers',
    description:
      'Add a customer. name is the business or person name. Give phone (10-digit Indian mobile) and email when known. Check with find_customers first so you do not add a duplicate.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Business or person name (shown everywhere)' },
        type: { type: 'string', enum: ['BUSINESS', 'INDIVIDUAL'], description: 'Default BUSINESS' },
        contact_first_name: { type: 'string', description: 'Contact person first name' },
        contact_last_name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        gst_number: { type: 'string' },
        address_line_1: { type: 'string' },
        address_line_2: { type: 'string' },
        city: { type: 'string' },
        state: { type: 'string' },
        postal_code: { type: 'string' },
        country: { type: 'string' },
        po_required: { type: 'boolean', description: 'Customer always sends a purchase order' },
      },
      required: ['name'],
    },
    permissions: ['customers.create'],
    kind: 'write',
    async run(args, ctx) {
      const name = textOf(args.name, 150);
      if (!name || name.length < 2) throw new ToolRefusal('Give the customer a name');
      const { phone, email } = contactChecks(args);
      const type = args.type === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'BUSINESS';
      const first = textOf(args.contact_first_name, 100) || (type === 'INDIVIDUAL' ? name.split(' ')[0] : null);
      const last = textOf(args.contact_last_name, 100) || (type === 'INDIVIDUAL' && !args.contact_first_name ? name.split(' ').slice(1).join(' ') || null : null);
      const hasContact = !!(first || phone || email);
      const hasAddress = ADDRESS_FIELDS.some((f) => textOf(args[f]));
      const payload: any = {
        customer_type: type,
        display_name: name,
        company_name: type === 'BUSINESS' ? name : undefined,
        gst_number: textOf(args.gst_number, 20)?.toUpperCase() || undefined,
        po_required: args.po_required === true,
        contacts: hasContact
          ? [{ first_name: first || name, last_name: last || undefined, phone, email, is_primary: 1 }]
          : [],
        addresses: hasAddress
          ? [
              {
                address_type: 'BILLING',
                ...Object.fromEntries(ADDRESS_FIELDS.map((f) => [f, textOf(args[f], 200) || undefined])),
                gst_number: textOf(args.gst_number, 20)?.toUpperCase() || undefined,
                is_primary: 1,
              },
            ]
          : [],
      };
      const r = fromResult(await ctx.s.customers.createCustomer(payload, ctx.user), 'Could not add the customer');
      const id = Number(r.data?.id) || null;
      return {
        ok: r.ok,
        message: r.ok ? `Added customer ${name}` : r.message,
        record: r.ok && id ? { type: 'customer', id, label: name } : undefined,
        data: r.ok ? { id, name, link: id ? recordLink('customer', id) : undefined } : { error: r.message },
      };
    },
  },
  {
    name: 'update_customer',
    group: 'Customers',
    label: 'Edit customers',
    description: "Change a customer's name, GST, PO rule, main contact (name, phone, email) or main address. Only pass what changes.",
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Customer id' },
        name: { type: 'string' },
        gst_number: { type: 'string' },
        po_required: { type: 'boolean' },
        contact_first_name: { type: 'string' },
        contact_last_name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        address_line_1: { type: 'string' },
        address_line_2: { type: 'string' },
        city: { type: 'string' },
        state: { type: 'string' },
        postal_code: { type: 'string' },
        country: { type: 'string' },
      },
      required: ['id'],
    },
    permissions: ['customers.edit'],
    kind: 'write',
    async run(args, ctx) {
      const id = customerId(args);
      const { phone, email } = contactChecks(args);
      const existing = fromResult(await ctx.s.customers.getCustomerDetails(id, ctx.user), 'Customer not found');
      if (!existing.ok || !existing.data) throw new ToolRefusal('That customer was not found');
      const c = typeof existing.data.toJSON === 'function' ? existing.data.toJSON() : existing.data;
      const payload: any = {};
      const name = textOf(args.name, 150);
      if (name) payload.display_name = name;
      if (args.gst_number !== undefined) payload.gst_number = textOf(args.gst_number, 20)?.toUpperCase() || null;
      if (typeof args.po_required === 'boolean') payload.po_required = args.po_required;

      // The service replaces the contact and address lists, so the rest is kept from the record.
      const contactGiven = ['contact_first_name', 'contact_last_name', 'phone', 'email'].some((k) => args[k] !== undefined);
      if (contactGiven) {
        const all: any[] = c.contacts || [];
        const main = all.find((x) => Number(x.is_primary) === 1) || all[0] || {};
        const updated = {
          ...(main.id ? { id: main.id } : {}),
          first_name: textOf(args.contact_first_name, 100) || main.first_name || name || c.display_name,
          last_name: args.contact_last_name !== undefined ? textOf(args.contact_last_name, 100) : main.last_name,
          phone: phone ?? main.phone,
          email: email ?? main.email,
          department: main.department,
          designation: main.designation,
          is_primary: 1,
        };
        payload.contacts = [updated, ...all.filter((x) => x !== main).map((x) => ({ ...x, is_primary: 0 }))];
      }
      const addressGiven = ADDRESS_FIELDS.some((k) => args[k] !== undefined);
      if (addressGiven) {
        const all: any[] = c.addresses || [];
        const main = all.find((x) => Number(x.is_primary) === 1) || all[0] || {};
        const updated: any = { ...(main.id ? { id: main.id } : {}), address_type: main.address_type || 'BILLING', label: main.label, gst_number: main.gst_number, is_primary: 1 };
        ADDRESS_FIELDS.forEach((f) => (updated[f] = args[f] !== undefined ? textOf(args[f], 200) : main[f]));
        payload.addresses = [updated, ...all.filter((x) => x !== main).map((x) => ({ ...x, is_primary: 0 }))];
      }
      if (!Object.keys(payload).length) throw new ToolRefusal('Nothing to change — say what should change');
      const r = fromResult(await ctx.s.customers.updateCustomer(id, payload, ctx.user), 'Could not update the customer');
      const label = payload.display_name || c.display_name || `Customer #${id}`;
      return {
        ok: r.ok,
        message: r.ok ? `Updated customer ${label}` : r.message,
        record: r.ok ? { type: 'customer', id, label } : undefined,
        data: r.ok ? { id, updated: Object.keys(payload), link: recordLink('customer', id) } : { error: r.message },
      };
    },
  },
  {
    name: 'delete_customer',
    group: 'Customers',
    label: 'Delete customers',
    description: 'Delete (hide) a customer. Their quotations and invoices stay. Needs the person to press Confirm.',
    parameters: { type: 'object', properties: { id: { type: 'number', description: 'Customer id' } }, required: ['id'] },
    permissions: ['customers.delete'],
    kind: 'confirm',
    async prepare(args, ctx) {
      const c = await mustFind(ctx, customerId(args));
      return {
        summary: `Delete customer ${c.name}`,
        details: [
          `They disappear from lists and pickers.`,
          `Their ${c.quotations} quotation${c.quotations === 1 ? '' : 's'} and ${c.invoices} invoice${c.invoices === 1 ? '' : 's'} are kept.`,
        ],
        args: { id: c.id },
        record: { type: 'customer', id: c.id, label: c.name },
      };
    },
    async run(args, ctx) {
      const c = await mustFind(ctx, customerId(args));
      const r = fromResult(await ctx.s.customers.deleteCustomer(c.id, ctx.user), 'Could not delete the customer');
      return { ok: r.ok, message: r.ok ? `Deleted customer ${c.name}` : r.message, data: { ok: r.ok, message: r.message } };
    },
  },
];
