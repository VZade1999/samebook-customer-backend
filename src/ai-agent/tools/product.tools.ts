import Groq from 'groq-sdk';

export const productTools: Groq.Chat.ChatCompletionTool[] = [
  // ── GET PRODUCTS ───────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_products_list',
      description: 'Fetch a list of products. Use for list/search/find requests. All parameters optional.',
      parameters: {
        type: 'object',
        properties: {
          category_id: { type: 'number', description: 'Filter by category ID' },
          name:        { type: 'string', description: 'Filter by product name (partial match)' },
          product_code:{ type: 'string', description: 'Filter by product code (partial match)' },
          sku:         { type: 'string', description: 'Filter by SKU (partial match)' },
          barcode:     { type: 'string', description: 'Filter by barcode (partial match)' },
          page:        { type: 'number', description: 'Page number (default: 1)' },
          limit:       { type: 'number', description: 'Records per page (default: 10)' },
        },
        required: [],
      },
    },
  },

  // ── CREATE PRODUCT ─────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_product',
      description: "Create a new product for the current user's own company. name and price are required.",
      parameters: {
        type: 'object',
        properties: {
          product_code:  { type: 'string', description: 'Product code (optional)' },
          name:          { type: 'string', description: 'Name of the product' },
          description:   { type: 'string', description: 'Product description' },
          unit:          { type: 'string', description: 'Product unit' },
          price:         { type: 'number', description: 'Product price' },
          cost_price:    { type: 'number', description: 'Product cost price' },
          tax_percentage:{ type: 'number', description: 'Tax percentage' },
          sku:           { type: 'string', description: 'SKU' },
          barcode:       { type: 'string', description: 'Barcode' },
          stock_quantity:{ type: 'number', description: 'Stock quantity' },
          minimum_stock: { type: 'number', description: 'Minimum stock level' },
          category_id:   { type: 'number', description: 'Category ID' },
          image_url:     { type: 'string', description: 'Image URL' },
        },
        required: ['name', 'price'],
      },
    },
  },

  // ── DELETE PRODUCT ─────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'delete_product',
      description: 'Delete a product by ID. Always confirm the ID with the user before deleting.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The ID of the product to delete' },
        },
        required: ['id'],
      },
    },
  },

  // ── UPDATE PRODUCT ─────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'update_product',
      description: 'Update a product by ID. id is required; only pass fields that need to change.',
      parameters: {
        type: 'object',
        properties: {
          id:            { type: 'number', description: 'The ID of the product to update' },
          name:          { type: 'string', description: 'New product name' },
          product_code:  { type: 'string', description: 'New product code' },
          description:   { type: 'string', description: 'New product description' },
          unit:          { type: 'string', description: 'New product unit' },
          price:         { type: 'number', description: 'New product price' },
          cost_price:    { type: 'number', description: 'New cost price' },
          tax_percentage:{ type: 'number', description: 'New tax percentage' },
          sku:           { type: 'string', description: 'New SKU' },
          barcode:       { type: 'string', description: 'New barcode' },
          stock_quantity:{ type: 'number', description: 'New stock quantity' },
          minimum_stock: { type: 'number', description: 'New minimum stock level' },
          category_id:   { type: 'number', description: 'New category ID' },
          image_url:     { type: 'string', description: 'New image URL' },
        },
        required: ['id'],
      },
    },
  },
];
