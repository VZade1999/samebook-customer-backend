import Groq from 'groq-sdk';

// Self-service only: this app has no cross-company listing, creation, or
// deletion, so these tools always operate on the caller's own company —
// no company ID is ever accepted from the model or the user.
export const companyTools: Groq.Chat.ChatCompletionTool[] = [
  // ── GET MY COMPANY DETAILS ────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_company_details',
      description: `Get the current user's own company details.
                    Use this when the user asks about their company's info, GST, address, etc.`,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },

  // ── GET MY COMPANY ADDRESSES ─────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_company_addresses',
      description: `Get all addresses for the current user's own company.`,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },

  // ── GET MY COMPANY LOCATIONS ─────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_company_locations',
      description: `Get all locations for the current user's own company.`,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },

  // ── UPDATE MY COMPANY ────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'update_company',
      description: `Update the current user's own company details.
                    Use this when the user wants to edit their company's info.
                    All fields are optional — only pass what the user wants changed.`,
      parameters: {
        type: 'object',
        properties: {
          name:                     { type: 'string', description: 'New company name' },
          legal_name:               { type: 'string', description: 'New legal name' },
          gst_no:                   { type: 'string', description: 'New GST number' },
          website:                  { type: 'string', description: 'New website' },
          industry:                 { type: 'string', description: 'New industry' },
          primary_email:            { type: 'string', description: 'New primary email' },
          primary_phone:            { type: 'string', description: 'New primary phone' },
          default_terms_conditions: { type: 'string', description: 'New default terms & conditions' },
        },
        required: [],
      },
    },
  },
];
