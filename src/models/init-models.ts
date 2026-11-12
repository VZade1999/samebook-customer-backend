import type { Sequelize } from 'sequelize';
import { users as _users, users } from './users';
import type { usersAttributes, usersCreationAttributes } from './users';
import { roles as _roles, roles } from './roles';
import type { rolesAttributes, rolesCreationAttributes } from './roles';
import { user_roles as _user_roles } from './user.roles';
import type {
  user_rolesAttributes,
  user_rolesCreationAttributes,
} from './user.roles';
import { permissions as _permissions } from './permissions';
import type { permissionsAttributes } from './permissions';
import { refresh_tokens as _refresh_tokens } from './refresh_tokens';
import type { refresh_tokensAttributes } from './refresh_tokens';
import { callback_requests as _callback_requests } from './callback_requests';
import type { callback_requestsAttributes } from './callback_requests';
import {
  role_permissions as _role_permissions,
  role_permissions,
} from './role.permissions';

import type {
  role_permissionsAttributes,
  role_permissionsCreationAttributes,
} from './role.permissions';
import { customers as _customers, customers } from './customers';
import type {
  customersAttributes,
  customersCreationAttributes,
} from './customers';
import {
  product_categories as _product_categories,
  product_categories,
} from './product_categories';
import type {
  product_categoriesAttributes,
  product_categoriesCreationAttributes,
} from './product_categories';
import {
  product_variants as _product_variants,
  product_variants,
} from './product_variants';
import type {
  product_variantsAttributes,
  product_variantsCreationAttributes,
} from './product_variants';
import {
  product_images as _product_images,
  product_images,
} from './product_images';
import type {
  product_imagesAttributes,
  product_imagesCreationAttributes,
} from './product_images';
import {
  product_inventory as _product_inventory,
  product_inventory,
} from './product_inventory';
import type {
  product_inventoryAttributes,
  product_inventoryCreationAttributes,
} from './product_inventory';
import {
  product_metadata as _product_metadata,
  product_metadata,
} from './product_metadata';
import type {
  product_metadataAttributes,
  product_metadataCreationAttributes,
} from './product_metadata';
import { products as _products, products } from './products';
import type {
  productsAttributes,
  productsCreationAttributes,
} from './products';
import { quotations as _quotations, quotations } from './quotations';
import type {
  quotationsAttributes,
  quotationsCreationAttributes,
} from './quotations';
import { companies as _companies, companies } from './companies';
import type {
  companiesAttributes,
  companiesCreationAttributes,
} from './companies';
import {
  company_addresses as _company_addresses,
  company_addresses,
} from './company_addresses';
import type {
  company_addressesAttributes,
  company_addressesCreationAttributes,
} from './company_addresses';
import {
  company_locations as _company_locations,
  company_locations,
} from './company_locations';
import type {
  company_locationsAttributes,
  company_locationsCreationAttributes,
} from './company_locations';
import {
  company_metadata as _company_metadata,
  company_metadata,
} from './company_metadata';
import type {
  company_metadataAttributes,
  company_metadataCreationAttributes,
} from './company_metadata';
import {
  quotation_items as _quotation_items,
  quotation_items,
} from './quotation-items';

import type {
  quotationItemsAttributes,
  quotationItemsCreationAttributes,
} from './quotation-items';

import {
  quotation_versions as _quotation_versions,
  quotation_versions,
} from './quotation-versions';

import {
  quotation_activity_logs as _quotation_activity_logs,
  quotation_activity_logs,
} from './quotation-activity-logs';

import type {
  quotationActivityLogsAttributes,
  quotationActivityLogsCreationAttributes,
} from './quotation-activity-logs';

import type {
  quotationVersionsAttributes,
  quotationVersionsCreationAttributes,
} from './quotation-versions';

import {
  customer_contacts as _customer_contacts,
  customer_contacts,
} from './customer_contacts';

import type {
  customer_contactsAttributes,
  customer_contactsCreationAttributes,
} from './customer_contacts';

import {
  customer_addresses as _customer_addresses,
  customer_addresses,
} from './customer_addresses';

import type {
  customer_addressesAttributes,
  customer_addressesCreationAttributes,
} from './customer_addresses';

import {
  company_bank_accounts as _company_bank_accounts,
  company_bank_accounts,
} from './company_bank_accounts';
import type {
  company_bank_accountsAttributes,
  company_bank_accountsCreationAttributes,
} from './company_bank_accounts';

import {
  invoices as _invoices,
  invoices,
} from './invoices';

import {
  invoice_items as _invoice_items,
  invoice_items,
} from './invoice_items';

import {
  invoice_payments as _invoice_payments,
  invoice_payments,
} from './invoice_payments';

import {
  invoice_activity_logs as _invoice_activity_logs,
  invoice_activity_logs,
} from './invoice_activity_logs';

import type {
  invoicesAttributes,
  invoicesCreationAttributes,
} from './invoices';

import type {
  invoiceItemsAttributes,
  invoiceItemsCreationAttributes,
} from './invoice_items';

import type {
  invoicePaymentsAttributes,
  invoicePaymentsCreationAttributes,
} from './invoice_payments';


import type {
  invoiceActivityLogsAttributes,
  invoiceActivityLogsCreationAttributes,
} from './invoice_activity_logs';

import { warehouses as _warehouses, warehouses } from './warehouses';
import type {
  warehousesAttributes,
  warehousesCreationAttributes,
} from './warehouses';




import { ai_agent_messages as _ai_agent_messages, ai_agent_messages } from './ai_agent_messages';
import type {
  ai_agent_messagesAttributes,
  ai_agent_messagesCreationAttributes,
} from './ai_agent_messages';

import {
  delivery_challans as _delivery_challans,
  delivery_challans,
} from './delivery_challans';
import type {
  delivery_challansAttributes,
  delivery_challansCreationAttributes,
} from './delivery_challans';
import {
  delivery_challan_items as _delivery_challan_items,
  delivery_challan_items,
} from './delivery_challan_items';
import type {
  delivery_challan_itemsAttributes,
  delivery_challan_itemsCreationAttributes,
} from './delivery_challan_items';
import {
  delivery_challan_activity_logs as _delivery_challan_activity_logs,
  delivery_challan_activity_logs,
} from './delivery_challan_activity_logs';
import type {
  delivery_challan_activity_logsAttributes,
  delivery_challan_activity_logsCreationAttributes,
} from './delivery_challan_activity_logs';

import { company_modules as _company_modules } from './company_modules';
import { notifications as _notifications } from './notifications';

export {
  _users as users,
  _roles as roles,
  _user_roles as user_roles,
  _permissions as permissions,
  _role_permissions as role_permissions,
  _customers as customers,
  _product_categories as product_categories,
  _product_variants as product_variants,
  _product_images as product_images,
  _product_inventory as product_inventory,
  _product_metadata as product_metadata,
  _products as products,
  _quotations as quotations,
  _companies as companies,
  _company_addresses as company_addresses,
  _company_locations as company_locations,
  _company_metadata as company_metadata,
  _company_bank_accounts as company_bank_accounts,
  _quotation_items as quotation_items,
  _quotation_versions as quotation_versions,
  _customer_contacts as customer_contacts,
  _customer_addresses as customer_addresses,
  _refresh_tokens as refresh_tokens,
  _callback_requests as callback_requests,
    _invoices as invoices,
  _invoice_items as invoice_items,
  _invoice_payments as invoice_payments,
  _invoice_activity_logs as invoice_activity_logs,
  _warehouses as warehouses,
  _ai_agent_messages as ai_agent_messages,
  _delivery_challans as delivery_challans,
  _delivery_challan_items as delivery_challan_items,
  _delivery_challan_activity_logs as delivery_challan_activity_logs,
};

export type {
  usersAttributes,
  rolesAttributes,
  user_rolesAttributes,
  permissionsAttributes,
  role_permissionsAttributes,
  customersAttributes,
  product_categoriesAttributes,
  product_variantsAttributes,
  product_imagesAttributes,
  product_inventoryAttributes,
  product_metadataAttributes,
  productsAttributes,
  companiesAttributes,
  company_addressesAttributes,
  company_locationsAttributes,
  company_metadataAttributes,
  company_bank_accountsAttributes,
  quotationItemsAttributes,
  quotationVersionsAttributes,
  customer_contactsAttributes,
  customer_addressesAttributes,
  refresh_tokensAttributes,
  callback_requestsAttributes,
   invoicesAttributes,
  invoiceItemsAttributes,
  invoicePaymentsAttributes,
  invoiceActivityLogsAttributes,
  warehousesAttributes,
  ai_agent_messagesAttributes,
  delivery_challansAttributes,
  delivery_challan_itemsAttributes,
  delivery_challan_activity_logsAttributes,
};

export function initModels(sequelize: Sequelize) {
  const users = _users.initModel(sequelize);
  const roles = _roles.initModel(sequelize);
  const user_roles = _user_roles.initModel(sequelize);
  const permission = _permissions.initModel(sequelize);
  const role_permissions = _role_permissions.initModel(sequelize);
  const refresh_tokens = _refresh_tokens.initModel(sequelize);
  const callback_requests = _callback_requests.initModel(sequelize);
  const customers = _customers.initModel(sequelize);
  const product_categories = _product_categories.initModel(sequelize);
  const products = _products.initModel(sequelize);
  const companies = _companies.initModel(sequelize);
  const company_addresses = _company_addresses.initModel(sequelize);
  const company_locations = _company_locations.initModel(sequelize);
  const company_metadata = _company_metadata.initModel(sequelize);
  const company_bank_accounts = _company_bank_accounts.initModel(sequelize);
  const quotations = _quotations.initModel(sequelize);
  const quotation_items = _quotation_items.initModel(sequelize);
  const quotation_versions = _quotation_versions.initModel(sequelize);
  const quotation_activity_logs = _quotation_activity_logs.initModel(sequelize);
  const customer_contacts = _customer_contacts.initModel(sequelize);
  const customer_addresses = _customer_addresses.initModel(sequelize);
  const invoices = _invoices.initModel(sequelize);
  const warehouses = _warehouses.initModel(sequelize);
  const ai_agent_messages = _ai_agent_messages.initModel(sequelize);
  const company_modules = _company_modules.initModel(sequelize);
  const notifications = _notifications.initModel(sequelize);

const invoice_items =
  _invoice_items.initModel(sequelize);

const invoice_payments =
  _invoice_payments.initModel(sequelize);

const invoice_activity_logs =
  _invoice_activity_logs.initModel(sequelize);

  // users <-> user_roles
  users.hasMany(user_roles, { as: 'user_roles', foreignKey: 'user_id' });
  user_roles.belongsTo(users, { as: 'user', foreignKey: 'user_id' });

  // roles <-> user_roles
  roles.hasMany(user_roles, { as: 'user_roles', foreignKey: 'role_id' });
  user_roles.belongsTo(roles, { as: 'role', foreignKey: 'role_id' });

  // roles <-> role_permissions  â† THIS WAS MISSING
  roles.hasMany(role_permissions, {
    as: 'role_permissions',
    foreignKey: 'role_id',
  });
  role_permissions.belongsTo(roles, { as: 'role', foreignKey: 'role_id' });

  // permissions <-> role_permissions
  permission.hasMany(role_permissions, {
    as: 'role_permissions',
    foreignKey: 'permission_id',
  });
  role_permissions.belongsTo(permission, {
    as: 'permission',
    foreignKey: 'permission_id',
  });

  // USERS <-> CUSTOMERS

  users.hasMany(customers, {
    as: 'customers',
    foreignKey: 'company_id',
    sourceKey: 'company_id',
  });
  customers.belongsTo(users, {
    as: 'company_user',
    foreignKey: 'company_id',
    targetKey: 'company_id',
  });

  //CUSTOMERS â†” CONTACTS
  // CUSTOMERS <-> CONTACTS

  customers.hasMany(customer_contacts, {
    as: 'contacts',
    foreignKey: 'customer_id',
  });

  customer_contacts.belongsTo(customers, {
    as: 'customer',
    foreignKey: 'customer_id',
  });

  //CUSTOMERS â†” ADDRESSES

  // CUSTOMERS <-> ADDRESSES

  customers.hasMany(customer_addresses, {
    as: 'addresses',
    foreignKey: 'customer_id',
  });

  customer_addresses.belongsTo(customers, {
    as: 'customer',
    foreignKey: 'customer_id',
  });

  users.hasMany(customer_contacts, {
    as: 'created_customer_contacts',
    foreignKey: 'created_by',
  });

  customer_contacts.belongsTo(users, {
    as: 'created_by_user',
    foreignKey: 'created_by',
  });

  users.hasMany(customer_contacts, {
    as: 'updated_customer_contacts',
    foreignKey: 'updated_by',
  });

  customer_contacts.belongsTo(users, {
    as: 'updated_by_user',
    foreignKey: 'updated_by',
  });

  //USERS â†” ADDRESSES (OPTIONAL)

  users.hasMany(customer_addresses, {
    as: 'created_customer_addresses',
    foreignKey: 'created_by',
  });

  customer_addresses.belongsTo(users, {
    as: 'created_by_user',
    foreignKey: 'created_by',
  });

  users.hasMany(customer_addresses, {
    as: 'updated_customer_addresses',
    foreignKey: 'updated_by',
  });

  customer_addresses.belongsTo(users, {
    as: 'updated_by_user',
    foreignKey: 'updated_by',
  });

  // PRODUCT CATEGORIES self-reference
  product_categories.hasMany(product_categories, {
    as: 'subcategories',
    foreignKey: 'parent_category_id',
  });
  product_categories.belongsTo(product_categories, {
    as: 'parent_category',
    foreignKey: 'parent_category_id',
  });

  // PRODUCT CATEGORIES <-> PRODUCTS
  product_categories.hasMany(products, {
    as: 'products',
    foreignKey: 'category_id',
  });
  products.belongsTo(product_categories, {
    as: 'category',
    foreignKey: 'category_id',
  });

  // PRODUCTS <-> VARIANTS
  const product_variants = _product_variants.initModel(sequelize);
  products.hasMany(product_variants, {
    as: 'variants',
    foreignKey: 'product_id',
  });
  product_variants.belongsTo(products, {
    as: 'product',
    foreignKey: 'product_id',
  });

  // PRODUCTS <-> IMAGES
  const product_images = _product_images.initModel(sequelize);
  products.hasMany(product_images, { as: 'images', foreignKey: 'product_id' });
  product_images.belongsTo(products, {
    as: 'product',
    foreignKey: 'product_id',
  });

  // VARIANTS <-> IMAGES
  product_variants.hasMany(product_images, {
    as: 'images',
    foreignKey: 'variant_id',
  });
  product_images.belongsTo(product_variants, {
    as: 'variant',
    foreignKey: 'variant_id',
  });

  // PRODUCTS <-> INVENTORY
  const product_inventory = _product_inventory.initModel(sequelize);
  products.hasMany(product_inventory, {
    as: 'inventory',
    foreignKey: 'product_id',
  });
  product_inventory.belongsTo(products, {
    as: 'product',
    foreignKey: 'product_id',
  });

  // VARIANTS <-> INVENTORY
  product_variants.hasMany(product_inventory, {
    as: 'inventory',
    foreignKey: 'variant_id',
  });
  product_inventory.belongsTo(product_variants, {
    as: 'variant',
    foreignKey: 'variant_id',
  });

  // PRODUCTS <-> METADATA
  const product_metadata = _product_metadata.initModel(sequelize);
  products.hasMany(product_metadata, {
    as: 'metadata',
    foreignKey: 'product_id',
  });
  product_metadata.belongsTo(products, {
    as: 'product',
    foreignKey: 'product_id',
  });

  // COMPANY RELATIONS
  companies.hasMany(company_addresses, {
    as: 'addresses',
    foreignKey: 'company_id',
  });
  company_addresses.belongsTo(companies, {
    as: 'company',
    foreignKey: 'company_id',
  });

  companies.hasMany(company_locations, {
    as: 'locations',
    foreignKey: 'company_id',
  });
  company_locations.belongsTo(companies, {
    as: 'company',
    foreignKey: 'company_id',
  });

  companies.hasMany(company_metadata, {
    as: 'metadata',
    foreignKey: 'company_id',
  });
  company_metadata.belongsTo(companies, {
    as: 'company',
    foreignKey: 'company_id',
  });

  companies.hasMany(company_bank_accounts, {
    as: 'bank_accounts',
    foreignKey: 'company_id',
  });
  company_bank_accounts.belongsTo(companies, {
    as: 'company',
    foreignKey: 'company_id',
  });

  company_addresses.hasMany(company_locations, {
    as: 'locations',
    foreignKey: 'address_id',
  });
  company_locations.belongsTo(company_addresses, {
    as: 'address',
    foreignKey: 'address_id',
  });

  //QUOTATIONS <-> CUSTOMERS
  customers.hasMany(quotations, {
    as: 'quotations',
    foreignKey: 'customer_id',
  });

  quotations.belongsTo(customers, {
    as: 'customer',
    foreignKey: 'customer_id',
  });

  //QUOTATIONS <-> COMPANIES
  companies.hasMany(quotations, {
    as: 'quotations',
    foreignKey: 'company_id',
  });

  quotations.belongsTo(companies, {
    as: 'company',
    foreignKey: 'company_id',
  });

  //QUOTATIONS <-> USERS (CREATED BY)
  users.hasMany(quotations, {
    as: 'created_quotations',
    foreignKey: 'created_by',
  });

  quotations.belongsTo(users, {
    as: 'created_by_user',
    foreignKey: 'created_by',
  });

  //QUOTATIONS <-> USERS (UPDATED BY)
  users.hasMany(quotations, {
    as: 'updated_quotations',
    foreignKey: 'updated_by',
  });

  quotations.belongsTo(users, {
    as: 'updated_by_user',
    foreignKey: 'updated_by',
  });

  //QUOTATIONS <-> ITEMS
  quotations.hasMany(quotation_items, {
    as: 'items',
    foreignKey: 'quotation_id',
  });

  quotation_items.belongsTo(quotations, {
    as: 'quotation',
    foreignKey: 'quotation_id',
  });

  //QUOTATIONS <-> VERSIONS
  quotations.hasMany(quotation_versions, {
    as: 'versions',
    foreignKey: 'quotation_id',
  });

  quotation_versions.belongsTo(quotations, {
    as: 'quotation',
    foreignKey: 'quotation_id',
  });

  users.hasMany(quotation_versions, {
    as: 'quotation_versions',
    foreignKey: 'changed_by',
  });

  quotation_versions.belongsTo(users, {
    as: 'changed_by_user',
    foreignKey: 'changed_by',
  });

  //QUOTATIONS <-> ACTIVITY LOGS
  quotations.hasMany(quotation_activity_logs, {
    as: 'activity_logs',
    foreignKey: 'quotation_id',
  });

  quotation_activity_logs.belongsTo(quotations, {
    as: 'quotation',
    foreignKey: 'quotation_id',
  });

  users.hasMany(quotation_activity_logs, {
    as: 'quotation_activity_logs',
    foreignKey: 'changed_by',
  });

  quotation_activity_logs.belongsTo(users, {
    as: 'changed_by_user',
    foreignKey: 'changed_by',
  });

  //Quotations â†” Invoices
  quotations.hasMany(invoices, {
  as: 'invoices',
  foreignKey: 'quotation_id',
});

invoices.belongsTo(quotations, {
  as: 'quotation',
  foreignKey: 'quotation_id',
});

//Companies â†” Invoices
companies.hasMany(invoices, {
  as: 'invoices',
  foreignKey: 'company_id',
});

invoices.belongsTo(companies, {
  as: 'company',
  foreignKey: 'company_id',
});

//Customers â†” Invoices
customers.hasMany(invoices, {
  as: 'invoices',
  foreignKey: 'customer_id',
});

invoices.belongsTo(customers, {
  as: 'customer',
  foreignKey: 'customer_id',
});

//Users â†” Invoices (Generated By)
users.hasMany(invoices, {
  as: 'generated_invoices',
  foreignKey: 'generated_by',
});

invoices.belongsTo(users, {
  as: 'generated_by_user',
  foreignKey: 'generated_by',
});

//Invoices â†” Invoice Items
invoices.hasMany(invoice_items, {
  as: 'items',
  foreignKey: 'invoice_id',
});

invoice_items.belongsTo(invoices, {
  as: 'invoice',
  foreignKey: 'invoice_id',
});

//Invoices â†” Payments
invoices.hasMany(invoice_payments, {
  as: 'payments',
  foreignKey: 'invoice_id',
});

invoice_payments.belongsTo(invoices, {
  as: 'invoice',
  foreignKey: 'invoice_id',
});

//Users â†” Payments
users.hasMany(invoice_payments, {
  as: 'invoice_payments',
  foreignKey: 'received_by',
});

invoice_payments.belongsTo(users, {
  as: 'received_by_user',
  foreignKey: 'received_by',
});

//Invoices â†” Activity Logs
invoices.hasMany(invoice_activity_logs, {
  as: 'activity_logs',
  foreignKey: 'invoice_id',
});

invoice_activity_logs.belongsTo(invoices, {
  as: 'invoice',
  foreignKey: 'invoice_id',
});

//Users â†” Invoice Activity Logs
users.hasMany(invoice_activity_logs, {
  as: 'invoice_activity_logs',
  foreignKey: 'changed_by',
});

invoice_activity_logs.belongsTo(users, {
  as: 'changed_by_user',
  foreignKey: 'changed_by',
});

  // COMPANIES <-> WAREHOUSES
  companies.hasMany(warehouses, {
    as: 'warehouses',
    foreignKey: 'company_id',
  });
  warehouses.belongsTo(companies, {
    as: 'company',
    foreignKey: 'company_id',
  });

  // WAREHOUSES <-> INVENTORY
  warehouses.hasMany(product_inventory, {
    as: 'inventory',
    foreignKey: 'warehouse_id',
  });
  product_inventory.belongsTo(warehouses, {
    as: 'warehouse',
    foreignKey: 'warehouse_id',
  });

  // Attendance & Leave models are registered by their feature module
  // (src/features/attendance/attendance.models.ts), not here.

  // users <-> refresh_tokens
  users.hasMany(refresh_tokens, { as: 'refresh_tokens', foreignKey: 'user_id' });
  refresh_tokens.belongsTo(users, { as: 'user', foreignKey: 'user_id' });

  // USERS <-> AI_AGENT_MESSAGES
  users.hasMany(ai_agent_messages, { as: 'ai_agent_messages', foreignKey: 'user_id' });
  ai_agent_messages.belongsTo(users, { as: 'user', foreignKey: 'user_id' });

  // DELIVERY CHALLANS
  const delivery_challans = _delivery_challans.initModel(sequelize);
  const delivery_challan_items = _delivery_challan_items.initModel(sequelize);
  const delivery_challan_activity_logs =
    _delivery_challan_activity_logs.initModel(sequelize);

  delivery_challans.hasMany(delivery_challan_items, {
    as: 'items',
    foreignKey: 'delivery_challan_id',
  });
  delivery_challan_items.belongsTo(delivery_challans, {
    as: 'challan',
    foreignKey: 'delivery_challan_id',
  });

  delivery_challans.hasMany(delivery_challan_activity_logs, {
    as: 'activity',
    foreignKey: 'delivery_challan_id',
  });
  delivery_challan_activity_logs.belongsTo(delivery_challans, {
    as: 'challan',
    foreignKey: 'delivery_challan_id',
  });
  delivery_challan_activity_logs.belongsTo(users, {
    as: 'changed_by_user',
    foreignKey: 'changed_by',
  });

  delivery_challans.belongsTo(warehouses, {
    as: 'from_warehouse',
    foreignKey: 'from_warehouse_id',
  });
  delivery_challans.belongsTo(warehouses, {
    as: 'to_warehouse',
    foreignKey: 'to_warehouse_id',
  });
  delivery_challans.belongsTo(quotations, {
    as: 'quotation',
    foreignKey: 'quotation_id',
  });
  delivery_challans.belongsTo(invoices, {
    as: 'invoice',
    foreignKey: 'invoice_id',
  });
  delivery_challans.belongsTo(users, {
    as: 'created_by_user',
    foreignKey: 'created_by',
  });

  // companies <-> users
  companies.hasMany(users, {
    as: 'users',
    foreignKey: 'company_id',
  });

  users.belongsTo(companies, {
    as: 'company',
    foreignKey: 'company_id',
  });

  // â”€â”€â”€ Company add-on modules â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  companies.hasMany(company_modules, { as: 'company_modules', foreignKey: 'company_id' });
  company_modules.belongsTo(companies, { as: 'company', foreignKey: 'company_id' });
  company_modules.belongsTo(users, { as: 'enabled_by_user', foreignKey: 'enabled_by' });

  // ─── In-app notifications ─────────────────────────────────
  notifications.belongsTo(users, { as: 'actor', foreignKey: 'actor_id' });

  return {
    users: users,
    roles: roles,
    user_roles: user_roles,
    role_permissions,
    permission: permission,
    customers,
    product_categories,
    products,
    product_variants,
    product_images,
    product_inventory,
    product_metadata,
    companies,
    company_addresses,
    company_locations,
    company_metadata,
    company_bank_accounts,
    quotations,
    quotation_items,
    quotation_versions,
    quotation_activity_logs,
    customer_contacts,
    customer_addresses,
    refresh_tokens,
    callback_requests,
     invoices,
    invoice_items,
    invoice_payments,
    invoice_activity_logs,
    warehouses,
    ai_agent_messages,
    delivery_challans,
    delivery_challan_items,
    delivery_challan_activity_logs,
    company_modules,
    notifications,
  };
}
