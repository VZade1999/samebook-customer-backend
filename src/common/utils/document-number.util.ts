import { DocumentType } from '../enums/document-type.enum';

export function generateDocumentNumber(
  documentType: string,
  companyPrefix: string,
  dailySequence: number,
  overallSequence: number,
): string {
  const now = new Date();
  const year = String(now.getFullYear() % 100).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateCode = `${year}${month}${day}`;

  const dailyCode = String(dailySequence).padStart(3, '0');
  const overallCode = String(overallSequence).padStart(4, '0');
  const prefix = companyPrefix?.trim().toUpperCase() || 'COMP';
  const type = documentType || DocumentType.QUOTATION;

  return `${type}-${prefix}-${dateCode}-${dailyCode}-${overallCode}`;
}
