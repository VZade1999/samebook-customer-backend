import type Groq from 'groq-sdk';
import { challanTools } from './challans';
import { companyTools } from './company';
import { customerTools } from './customers';
import { invoiceTools } from './invoices';
import { overviewTools } from './overview';
import { productTools } from './products';
import { quotationTools } from './quotations';
import type { AiTool } from './types';

/** Every ability, in the order "What I can do" lists them. */
export const AI_TOOLS: readonly AiTool[] = [
  ...overviewTools,
  ...customerTools,
  ...productTools,
  ...quotationTools,
  ...challanTools,
  ...invoiceTools,
  ...companyTools,
];

export const TOOL_BY_NAME: ReadonlyMap<string, AiTool> = new Map(AI_TOOLS.map((t) => [t.name, t]));

export const GROUP_ORDER = ['Overview', 'Customers', 'Products & stock', 'Quotations', 'Delivery challans', 'Invoices', 'Company'];

/** The definition the AI sees (name, short description, arguments). */
export const toModelTool = (t: AiTool): Groq.Chat.ChatCompletionTool => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.parameters as any },
});

/** Argument names an ability declares. */
export const declaredArgs = (t: AiTool) => Object.keys(t.parameters.properties || {});
