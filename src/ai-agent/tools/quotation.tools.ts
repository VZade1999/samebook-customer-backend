import Groq from 'groq-sdk';

// Matches QuotationItemDto exactly — the model must produce objects in this
// shape or the fields silently don't map to anything the backend reads
// (qty/rate default to 1/0, product_name to '').
const quotationItemSchema = {
  type: 'object',
  properties: {
    product_name:      { type: 'string', description: 'Name of the product/line item' },
    hsn_code:          { type: 'string', description: 'HSN/product code (optional — look this up from get_products_list if the item matches an existing product)' },
    unit:              { type: 'string', description: 'Unit of measure, e.g. pcs, kg (optional)' },
    qty:               { type: 'number', description: 'Quantity' },
    rate:              { type: 'number', description: 'Price per unit' },
    discount_percent:  { type: 'number', description: 'Line-item discount percentage (optional)' },
  },
  required: ['product_name', 'qty', 'rate'],
};

export const quotationTools: Groq.Chat.ChatCompletionTool[] = [
  // ── GET QUOTATIONS ───────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_quotations_list',
      description: 'Fetch a list of quotations. Use for list/search/find requests. All parameters optional.',
      parameters: {
        type: 'object',
        properties: {
          customer_id: { type: 'number', description: 'Filter by customer ID' },
          status:      { type: 'string', description: 'Filter by status' },
          page:        { type: 'number', description: 'Page number (default: 1)' },
          limit:       { type: 'number', description: 'Records per page (default: 10)' },
        },
        required: [],
      },
    },
  },

  // ── CREATE QUOTATION ─────────────────────────────────────────────────
  // company_id is deliberately not a parameter here — it's always the
  // authenticated caller's own company, never accepted from the model.
  {
    type: 'function',
    function: {
      name: 'create_quotation',
      description:
        "Create a new quotation for the current user's own company. Look up product details with get_products_list first for existing products. GST is computed automatically server-side — never ask for a tax rate. " +
        "Contact person, billing/shipping address, and bank account for payment details all auto-resolve when the customer/company only has one option (or one marked default/primary) — if this tool's response instead reports multiple options to choose from, ask the user which one and call it again with contact_person_id/billing_address_id/shipping_address_id/bank_account_id set, rather than guessing.",
      parameters: {
        type: 'object',
        properties: {
          customer_id:        { type: 'number', description: 'Customer ID' },
          items:              { type: 'array', description: 'Line items on the quotation', items: quotationItemSchema },
          discount_amount:    { type: 'number', description: 'Flat discount amount off the subtotal (optional)' },
          transport_charges:  { type: 'number', description: 'Transport/shipping charges to add (optional)' },
          notes:              { type: 'string', description: 'Additional notes (optional)' },
          quotation_date:     { type: 'string', description: 'Quotation date, YYYY-MM-DD (optional — defaults to today)' },
          contact_person_id:  { type: 'number', description: "The customer's contact person ID — only pass this if the user specified one or a prior call asked you to choose" },
          billing_address_id: { type: 'number', description: 'Billing address ID — only pass this if the user specified one or a prior call asked you to choose' },
          shipping_address_id:{ type: 'number', description: 'Shipping address ID — only pass this if the user specified one or a prior call asked you to choose' },
          bank_account_id:    { type: 'number', description: "The company's bank account ID to show as payment details — only pass this if the user specified one or a prior call asked you to choose" },
        },
        required: ['customer_id', 'items'],
      },
    },
  },

  // ── GET QUOTATION DETAILS ────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_quotation_details',
      description: `Get details of a specific quotation by ID.`,
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The quotation ID' },
        },
        required: ['id'],
      },
    },
  },

  // ── GET QUOTATION HISTORY ────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_quotation_history',
      description: `Get change history of a specific quotation by ID.`,
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The quotation ID' },
        },
        required: ['id'],
      },
    },
  },

  // ── GET QUOTATION TIMELINE ───────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_quotation_timeline',
      description: `Get timeline events of a specific quotation by ID.`,
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The quotation ID' },
        },
        required: ['id'],
      },
    },
  },

  // ── UPDATE QUOTATION ─────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'update_quotation',
      description:
        'Update a quotation by ID. Only pass fields that need to change. If updating items, pass the FULL replacement array (it replaces, not merges) — fetch current items via get_quotation_details first if some need to be kept.',
      parameters: {
        type: 'object',
        properties: {
          id:              { type: 'number', description: 'The quotation ID' },
          items:           { type: 'array', description: 'Full replacement items array', items: quotationItemSchema },
          discount_amount: { type: 'number', description: 'New flat discount amount off the subtotal' },
          transport_charges: { type: 'number', description: 'New transport/shipping charges' },
          notes:           { type: 'string', description: 'New notes' },
          status:          { type: 'string', description: 'New status' },
        },
        required: ['id'],
      },
    },
  },

  // ── SEND QUOTATION ───────────────────────────────────────────────────
  // user_id is deliberately not a parameter here — it's always the
  // authenticated caller, so audit trails (changed_by) can't be spoofed.
  {
    type: 'function',
    function: {
      name: 'send_quotation',
      description: `Send a quotation to the customer by quotation ID.`,
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The quotation ID' },
        },
        required: ['id'],
      },
    },
  },

  // ── DELETE QUOTATION ─────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'delete_quotation',
      description: 'Delete a quotation by ID. Always confirm the ID with the user before deleting.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The quotation ID' },
        },
        required: ['id'],
      },
    },
  },
];
