import Groq from 'groq-sdk';
import { customerTools } from './customer.tools';
import { productTools } from './product.tools';
import { companyTools } from './company.tools';
import { quotationTools } from './quotation.tools';

export const allTools: Groq.Chat.ChatCompletionTool[] = [
  ...customerTools,
  ...productTools,
  ...companyTools,
  ...quotationTools,
];

export { customerTools, productTools, companyTools, quotationTools };
