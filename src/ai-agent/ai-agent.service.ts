import { Injectable } from '@nestjs/common';
import { AppLogger } from 'src/common/logger/logger.service';
import { ChatDto } from './dto/chat.dto';
import { CustomerService } from 'src/customers/customers.service';
import { ProductService } from 'src/products/products.service';
import { CompanyService } from 'src/companies/companies.service';
import { QuotationService } from 'src/quotations/quotations.service';
import Groq from 'groq-sdk';

@Injectable()
export class AiAgentService {
  private readonly groq: Groq;

  constructor(
    private readonly appLogger: AppLogger,
    private readonly customerService: CustomerService,
    private readonly productService: ProductService,
    private readonly companyService: CompanyService,
    private readonly quotationService: QuotationService,
  ) {
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
  }

  // =========================
  // TOOL DEFINITIONS
  // =========================

  private readonly tools: Groq.Chat.ChatCompletionTool[] = [

    // ── GET CUSTOMERS ────────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'get_customers_list',
        description: `Fetch a list of customers from the database.
                      Use this when the user asks to see, find, search, or list customers.
                      All parameters are optional — only pass what the user mentions.`,
        parameters: {
          type: 'object',
          properties: {
            first_name:   { type: 'string', description: 'Filter by first name (partial match)' },
            last_name:    { type: 'string', description: 'Filter by last name (partial match)' },
            email:        { type: 'string', description: 'Filter by email (partial match)' },
            phone:        { type: 'string', description: 'Filter by phone number (partial match)' },
            company_name: { type: 'string', description: 'Filter by company name (partial match)' },
            city:         { type: 'string', description: 'Filter by city (partial match)' },
            country:      { type: 'string', description: 'Filter by country (partial match)' },
            page:         { type: 'number', description: 'Page number (default: 1)' },
            limit:        { type: 'number', description: 'Records per page (default: 10)' },
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
        description: `Create a new customer in the database.
                      Use this when the user wants to add or create a new customer.
                      first_name, last_name, email and phone are required.`,
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
        description: `Delete a customer by their ID.
                      Use this when the user wants to remove or delete a customer.
                      Always confirm the customer ID before deleting.`,
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
        description: `Update an existing customer's details by their ID.
                      Use this when the user wants to edit or update a customer.
                      id is required. All other fields are optional — only pass what needs to change.`,
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

    // ── GET PRODUCTS ───────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'get_products_list',
        description: `Fetch a list of products from the database.
                      Use this when the user asks to list, search, or find products.
                      All parameters are optional — only pass what the user mentions.`,
        parameters: {
          type: 'object',
          properties: {
            company_id:  { type: 'number', description: 'Filter by company ID' },
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
        description: `Create a new product in the database.
                      Use this when the user wants to add or create a new product.
                      name, price, and company_id are required.`,
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
            company_id:    { type: 'number', description: 'Company ID' },
            category_id:   { type: 'number', description: 'Category ID' },
            image_url:     { type: 'string', description: 'Image URL' },
          },
          required: ['name', 'price', 'company_id'],
        },
      },
    },

    // ── DELETE PRODUCT ─────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'delete_product',
        description: `Delete a product by its ID.
                      Use this when the user wants to remove or delete a product.
                      Always confirm the product ID before deleting.`,
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
        description: `Update an existing product's details by its ID.
                      Use this when the user wants to edit or update a product.
                      id is required. All other fields are optional — only pass what needs to change.`,
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

    // ── GET COMPANIES ───────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'get_companies_list',
        description: `Fetch a list of companies from the database.
                      Use this when the user asks to list, search, or find companies.
                      All parameters are optional — only pass what the user mentions.`,
        parameters: {
          type: 'object',
          properties: {
            name:   { type: 'string', description: 'Filter by company name (partial match)' },
            email:  { type: 'string', description: 'Filter by email (partial match)' },
            phone:  { type: 'string', description: 'Filter by phone (partial match)' },
            city:   { type: 'string', description: 'Filter by city (partial match)' },
            page:   { type: 'number', description: 'Page number (default: 1)' },
            limit:  { type: 'number', description: 'Records per page (default: 10)' },
          },
          required: [],
        },
      },
    },

    // ── CREATE COMPANY ───────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'create_company',
        description: `Create a new company in the database.
                      Use this when the user wants to add or create a new company.
                      name is required.`,
        parameters: {
          type: 'object',
          properties: {
            name:           { type: 'string', description: 'Company name' },
            email:          { type: 'string', description: 'Company email' },
            phone:          { type: 'string', description: 'Company phone' },
            address_line_1: { type: 'string', description: 'Address line 1' },
            address_line_2: { type: 'string', description: 'Address line 2' },
            city:           { type: 'string', description: 'City' },
            state:          { type: 'string', description: 'State' },
            country:        { type: 'string', description: 'Country' },
            postal_code:    { type: 'string', description: 'Postal code' },
          },
          required: ['name'],
        },
      },
    },

    // ── GET COMPANY DETAILS ──────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'get_company_details',
        description: `Get details of a specific company by ID.
                      Use this when the user asks for detailed info about a company.`,
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'The company ID' },
          },
          required: ['id'],
        },
      },
    },

    // ── GET COMPANY ADDRESSES ────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'get_company_addresses',
        description: `Get all addresses associated with a company by company ID.`,
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'The company ID' },
          },
          required: ['id'],
        },
      },
    },

    // ── GET COMPANY LOCATIONS ────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'get_company_locations',
        description: `Get all locations associated with a company by company ID.`,
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'The company ID' },
          },
          required: ['id'],
        },
      },
    },

    // ── UPDATE COMPANY ───────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'update_company',
        description: `Update an existing company's details by its ID.
                      Use this when the user wants to edit or update a company.
                      id is required. All other fields are optional.`,
        parameters: {
          type: 'object',
          properties: {
            id:             { type: 'number', description: 'The company ID' },
            name:           { type: 'string', description: 'New company name' },
            email:          { type: 'string', description: 'New email' },
            phone:          { type: 'string', description: 'New phone' },
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

    // ── DELETE COMPANY ───────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'delete_company',
        description: `Delete a company by its ID.
                      Use this when the user wants to remove or delete a company.
                      Always confirm the company ID before deleting.`,
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'The company ID to delete' },
          },
          required: ['id'],
        },
      },
    },

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
            company_id:  { type: 'number', description: 'Filter by company ID' },
            status:      { type: 'string', description: 'Filter by status' },
            page:        { type: 'number', description: 'Page number (default: 1)' },
            limit:       { type: 'number', description: 'Records per page (default: 10)' },
          },
          required: [],
        },
      },
    },

    // ── CREATE QUOTATION ─────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'create_quotation',
        description: `Create a new quotation in the database.
                      Use this when the user wants to add or create a new quotation.`,
        parameters: {
          type: 'object',
          properties: {
            customer_id: { type: 'number', description: 'Customer ID' },
            company_id:  { type: 'number', description: 'Company ID' },
            items:       { type: 'array', description: 'Array of quotation items' },
            discount:    { type: 'number', description: 'Discount amount or percentage' },
            tax:         { type: 'number', description: 'Tax amount' },
            notes:       { type: 'string', description: 'Additional notes' },
          },
          required: ['customer_id', 'company_id', 'items'],
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
    {
      type: 'function',
      function: {
        name: 'send_quotation',
        description: `Send a quotation to the customer by quotation ID.`,
        parameters: {
          type: 'object',
          properties: {
            id:      { type: 'number', description: 'The quotation ID' },
            user_id: { type: 'number', description: 'User ID (optional)' },
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
            id:      { type: 'number', description: 'The quotation ID' },
            user_id: { type: 'number', description: 'User ID (optional)' },
          },
          required: ['id'],
        },
      },
    },
  ];

  // =========================
  // TOOL EXECUTOR
  // =========================

  private async executeTool(name: string, args: any, currentUser: { company_id: number; user_id: number }): Promise<string> {
    const log = this.appLogger.forContext('AiAgentService', 'executeTool', { tool: name });
    log.info(`Executing tool: ${name}`, { args });

    try {
      switch (name) {

        // ── GET CUSTOMERS ──────────────────────────────────────────────────
        case 'get_customers_list': {
          const result = await this.customerService.getCustomersList(args, currentUser);
          return JSON.stringify(result.data);
        }

        // ── CREATE CUSTOMER ────────────────────────────────────────────────
        case 'create_customer': {
          const result = await this.customerService.createCustomer(args, currentUser);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        // ── DELETE CUSTOMER ────────────────────────────────────────────────
        case 'delete_customer': {
          const result = await this.customerService.deleteCustomer(args.id, currentUser);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        // ── UPDATE CUSTOMER ────────────────────────────────────────────────
        case 'update_customer': {
          const { id, ...updateData } = args;
          const result = await this.customerService.updateCustomer(id, updateData, currentUser);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        // ── GET PRODUCTS ─────────────────────────────────────────────────
        case 'get_products_list': {
          const result = await this.productService.getProductsList(args);
          return JSON.stringify(result.data);
        }

        // ── CREATE PRODUCT ────────────────────────────────────────────────
        case 'create_product': {
          const result = await this.productService.createProduct(args);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        // ── DELETE PRODUCT ────────────────────────────────────────────────
        case 'delete_product': {
          const result = await this.productService.deleteProduct(args.id);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        // ── UPDATE PRODUCT ────────────────────────────────────────────────
        case 'update_product': {
          const { id, ...updateData } = args;
          const result = await this.productService.updateProduct(id, updateData);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        // ── GET COMPANIES ──────────────────────────────────────────────────
        case 'get_companies_list': {
          const result = await this.companyService.getCompaniesList(args);
          return JSON.stringify(result.data);
        }

        // ── CREATE COMPANY ────────────────────────────────────────────────
        case 'create_company': {
          const result = await this.companyService.createCompany(args);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        // ── GET COMPANY DETAILS ──────────────────────────────────────────
        case 'get_company_details': {
          const result = await this.companyService.getCompanyById(args.id);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        // ── GET COMPANY ADDRESSES ────────────────────────────────────────
        case 'get_company_addresses': {
          const result = await this.companyService.getCompanyAddresses(args.id);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        // ── GET COMPANY LOCATIONS ────────────────────────────────────────
        case 'get_company_locations': {
          const result = await this.companyService.getCompanyLocations(args.id);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        // ── UPDATE COMPANY ────────────────────────────────────────────────
        case 'update_company': {
          const { id, ...updateData } = args;
          const result = await this.companyService.updateCompany(id, updateData);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        // ── DELETE COMPANY ────────────────────────────────────────────────
        case 'delete_company': {
          const result = await this.companyService.deleteCompany(args.id);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        // ── GET QUOTATIONS ────────────────────────────────────────────────
        case 'get_quotations_list': {
          const result = await this.quotationService.getQuotations(args, currentUser);
          return JSON.stringify(result.data);
        }

        // ── CREATE QUOTATION ──────────────────────────────────────────────
        case 'create_quotation': {
          const result = await this.quotationService.createQuotation(args);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        // ── GET QUOTATION DETAILS ─────────────────────────────────────────
        case 'get_quotation_details': {
          const result = await this.quotationService.getQuotationDetails(args.id);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        // ── GET QUOTATION HISTORY ─────────────────────────────────────────
        case 'get_quotation_history': {
          const result = await this.quotationService.getQuotationHistory(args.id);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        // ── GET QUOTATION TIMELINE ────────────────────────────────────────
        case 'get_quotation_timeline': {
          const result = await this.quotationService.getQuotationTimeline(args.id);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        // ── UPDATE QUOTATION ──────────────────────────────────────────────
        case 'update_quotation': {
          const { id, ...updateData } = args;
          const result = await this.quotationService.updateQuotation(id, updateData);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        // ── SEND QUOTATION ────────────────────────────────────────────────
        case 'send_quotation': {
          const result = await this.quotationService.sendQuotation(args.id, args.user_id);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        // ── DELETE QUOTATION ──────────────────────────────────────────────
        case 'delete_quotation': {
          const result = await this.quotationService.deleteQuotation(args.id, args.user_id);
          return JSON.stringify({
            success: result.success,
            message: result.message,
            data: result.data ?? null,
          });
        }

        default:
          return JSON.stringify({ error: `Unknown tool: ${name}` });
      }
    } catch (err:any) {
      log.error(`Tool execution failed: ${name}`, err);
      return JSON.stringify({ error: `Tool ${name} failed`, details: err?.message });
    }
  }

  // =========================
  // CHAT
  // =========================

  async chat(data: ChatDto, currentUser: { company_id: number; user_id: number }) {
    const log = this.appLogger.forContext('AiAgentService', 'chat', {
      session_id: data.session_id ?? 'no-session',
      company_id: currentUser.company_id,
    });

    log.info('AI Agent chat attempt started');

    try {
      // ── Build message history ────────────────────────────────────────────
      const messages: Groq.Chat.ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: `You are a helpful AI assistant for a customer management system.
                    You have access to the following tools:
                    
                    CUSTOMERS:
                    - get_customers_list: search and list customers
                    - create_customer: add a new customer
                    - update_customer: edit an existing customer by ID
                    - delete_customer: remove a customer by ID
                    
                    PRODUCTS:
                    - get_products_list: search and list products
                    - create_product: add a new product
                    - update_product: edit an existing product by ID
                    - delete_product: remove a product by ID
                    
                    COMPANIES:
                    - get_companies_list: search and list companies
                    - create_company: add a new company
                    - get_company_details: fetch details of a specific company
                    - get_company_addresses: fetch all addresses for a company
                    - get_company_locations: fetch all locations for a company
                    - update_company: edit an existing company by ID
                    - delete_company: remove a company by ID
                    
                    QUOTATIONS:
                    - get_quotations_list: search and list quotations
                    - create_quotation: create a new quotation
                    - get_quotation_details: fetch details of a specific quotation
                    - get_quotation_history: fetch change history for a quotation
                    - get_quotation_timeline: fetch timeline events for a quotation
                    - update_quotation: edit an existing quotation by ID
                    - send_quotation: send a quotation to a customer
                    - delete_quotation: remove a quotation by ID

                    Always use the appropriate tool when the user asks to perform any of these actions.
                    Present results clearly and confirm actions after they are completed.
                    If required fields are missing (e.g. email for create customer), ask the user for them before proceeding.`,
        },
        ...(data.history ?? []).map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        })),
        {
          role: 'user' as const,
          content: data.message,
        },
      ];

      // ── First call — AI decides if it needs a tool ───────────────────────
      let completion = await this.groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages,
        tools: this.tools,
        tool_choice: 'auto',
        max_tokens: 1024,
        temperature: 0.7,
      });

      let responseMessage = completion.choices[0]?.message;

      // ── Tool call loop ───────────────────────────────────────────────────
      while (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
        log.info(`Tool calls requested: ${responseMessage.tool_calls.map(t => t.function.name).join(', ')}`);

        messages.push(responseMessage);

        for (const toolCall of responseMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments || '{}');

          log.info(`Running tool: ${toolName}`, { args: toolArgs });

          const toolResult = await this.executeTool(toolName, toolArgs, currentUser);

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult,
          });
        }

        // ── Follow-up call — AI forms final reply after tool result ──────
        completion = await this.groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages,
          tools: this.tools,
          tool_choice: 'auto',
          max_tokens: 1024,
          temperature: 0.7,
        });

        responseMessage = completion.choices[0]?.message;
      }

      const reply = responseMessage?.content ?? '';

      log.info('AI Agent chat response received');

      return {
        success: true,
        message: 'Response generated successfully',
        data: {
          reply,
          session_id: data.session_id,
          usage: {
            input_tokens: completion.usage?.prompt_tokens ?? 0,
            output_tokens: completion.usage?.completion_tokens ?? 0,
            total_tokens: completion.usage?.total_tokens ?? 0,
          },
        },
      };
    } catch (err: any) {
      const is429 = err?.message?.includes('429') || err?.status === 429;

      if (is429) {
        log.warn('Groq rate limit hit');
        return {
          success: false,
          message: 'Rate limit exceeded. Please try again in a moment.',
          data: null,
        };
      }

      log.error('Groq API error', err, { message: err?.message });
      throw new Error('AI_AGENT_ERROR');
    }
  }
}