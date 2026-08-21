import Groq from 'groq-sdk';

export const customerTools: Groq.Chat.ChatCompletionTool[] = [
  // ── GET CUSTOMERS ────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_customers_list',
      description: 'Fetch a list of customers. Use for see/find/search/list requests. All parameters optional.',
      parameters: {
        type: 'object',
        properties: {
          search:        { type: 'string', description: 'Free-text search across display name, company name, and GST number' },
          customer_type: { type: 'string', enum: ['INDIVIDUAL', 'BUSINESS'], description: 'Filter by customer type' },
          display_name:  { type: 'string', description: 'Filter by display name (partial match)' },
          company_name:  { type: 'string', description: 'Filter by company name (partial match)' },
          gst_number:    { type: 'string', description: 'Filter by GST number (partial match)' },
          industry:      { type: 'string', description: 'Filter by industry (exact match)' },
          email:         { type: 'string', description: "Filter by a contact's email (partial match)" },
          phone:         { type: 'string', description: "Filter by a contact's phone number (partial match)" },
          city:          { type: 'string', description: "Filter by an address's city (partial match)" },
          state:         { type: 'string', description: "Filter by an address's state (partial match)" },
          country:       { type: 'string', description: "Filter by an address's country (partial match)" },
          page:          { type: 'number', description: 'Page number (default: 1)' },
          limit:         { type: 'number', description: 'Records per page (default: 10)' },
        },
        required: [],
      },
    },
  },

  // ── CREATE CUSTOMER ──────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_customer',
      description: 'Create a new customer. first_name, last_name, email and phone are required.',
      parameters: {
        type: 'object',
        properties: {
          first_name:     { type: 'string', description: 'First name of the customer' },
          last_name:      { type: 'string', description: 'Last name of the customer' },
          email:          { type: 'string', description: 'Email address of the customer' },
          phone:          { type: 'string', description: 'Phone number of the customer' },
          company_name:   { type: 'string', description: 'Company name (optional)' },
          address_line_1: { type: 'string', description: 'Address line 1 (optional)' },
          address_line_2: { type: 'string', description: 'Address line 2 (optional)' },
          city:           { type: 'string', description: 'City (optional)' },
          state:          { type: 'string', description: 'State (optional)' },
          country:        { type: 'string', description: 'Country (optional)' },
          postal_code:    { type: 'string', description: 'Postal code (optional)' },
        },
        required: ['first_name', 'last_name', 'email', 'phone'],
      },
    },
  },

  // ── DELETE CUSTOMER ──────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'delete_customer',
      description: 'Delete a customer by ID. Always confirm the ID with the user before deleting.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The ID of the customer to delete' },
        },
        required: ['id'],
      },
    },
  },

  // ── UPDATE CUSTOMER ──────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'update_customer',
      description: 'Update a customer by ID. id is required; only pass fields that need to change.',
      parameters: {
        type: 'object',
        properties: {
          id:             { type: 'number', description: 'The ID of the customer to update' },
          first_name:     { type: 'string', description: 'New first name' },
          last_name:      { type: 'string', description: 'New last name' },
          email:          { type: 'string', description: 'New email address' },
          phone:          { type: 'string', description: 'New phone number' },
          company_name:   { type: 'string', description: 'New company name' },
          address_line_1: { type: 'string', description: 'New address line 1' },
          address_line_2: { type: 'string', description: 'New address line 2' },
          city:           { type: 'string', description: 'New city' },
          state:          { type: 'string', description: 'New state' },
          country:        { type: 'string', description: 'New country' },
          postal_code:    { type: 'string', description: 'New postal code' },
        },
        required: ['id'],
      },
    },
  },
];
