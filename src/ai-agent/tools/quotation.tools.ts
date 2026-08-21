import Groq from 'groq-sdk';

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
                    Use this when the user wants to add or create a new quotation.`,
      parameters: {
        type: 'object',
        properties: {
          customer_id: { type: 'number', description: 'Customer ID' },
          items:       { type: 'array', description: 'Array of quotation items' },
          discount:    { type: 'number', description: 'Discount amount or percentage' },
          tax:         { type: 'number', description: 'Tax amount' },
          notes:       { type: 'string', description: 'Additional notes' },
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
                    id is required. All other fields are optional.`,
      parameters: {
        type: 'object',
        properties: {
          id:       { type: 'number', description: 'The quotation ID' },
          items:    { type: 'array', description: 'New items array' },
          discount: { type: 'number', description: 'New discount' },
          tax:      { type: 'number', description: 'New tax' },
          notes:    { type: 'string', description: 'New notes' },
          status:   { type: 'string', description: 'New status' },
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
