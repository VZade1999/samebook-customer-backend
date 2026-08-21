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
      description: `Fetch a list of quotations from the database.
                    Use this when the user asks to list, search, or find quotations.
                    All parameters are optional.`,
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
      description: `Create a new quotation for the current user's own company.
                    Use this when the user wants to add or create a new quotation.
                    Look up product details with get_products_list first if the
                    user references an existing product, so you can pass its
                    real name/price/HSN code as the line item.
                    Billing/shipping address is resolved automatically from the
                    customer's saved address — you don't need to ask for one.
                    GST (CGST/SGST/IGST) is computed automatically by the
                    server from the company's and customer's states — do not
                    ask the user for a tax rate.`,
      parameters: {
        type: 'object',
        properties: {
          customer_id:    { type: 'number', description: 'Customer ID' },
          items:          { type: 'array', description: 'Line items on the quotation', items: quotationItemSchema },
          discount_amount:{ type: 'number', description: 'Flat discount amount off the subtotal (optional)' },
          transport_charges: { type: 'number', description: 'Transport/shipping charges to add (optional)' },
          notes:          { type: 'string', description: 'Additional notes (optional)' },
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
      description: `Update an existing quotation by its ID.
                    id is required. All other fields are optional — only pass
                    what needs to change. If updating items, pass the FULL
                    new items array (it replaces the existing items, it does
                    not merge with them) — fetch the current items with
                    get_quotation_details first if you need to keep some.`,
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
      description: `Delete a quotation by its ID.
                    Always confirm the quotation ID before deleting.`,
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
