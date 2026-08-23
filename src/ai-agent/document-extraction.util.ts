import * as Tesseract from 'tesseract.js';
import { PDFParse } from 'pdf-parse';

export class DocumentExtractionError extends Error {}

// A text-layer PDF extraction shorter than this is almost certainly a
// scanned/image-only PDF with no real text — OCR-from-PDF isn't supported
// in this pass (would need rendering pages to images first), so this is
// reported back as a clear, actionable error instead of silently handing
// the model a near-empty document.
const MIN_PDF_TEXT_LENGTH = 20;

export async function extractTextFromDocument(
  base64: string,
  mimeType: string,
): Promise<string> {
  const buffer = Buffer.from(base64, 'base64');

  if (mimeType === 'application/pdf') {
    let text: string;
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      text = (result.text || '').trim();
    } catch (err: any) {
      throw new DocumentExtractionError(
        `Could not read this PDF: ${err?.message || 'unknown error'}`,
      );
    } finally {
      await parser.destroy();
    }

    if (text.length < MIN_PDF_TEXT_LENGTH) {
      throw new DocumentExtractionError(
        'This PDF appears to be a scanned image with no selectable text. Please upload it as a photo/image (JPG or PNG) instead so it can be read via OCR.',
      );
    }

    return text;
  }

  if (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp') {
    try {
      const {
        data: { text },
      } = await Tesseract.recognize(buffer, 'eng');
      const trimmed = text.trim();
      if (!trimmed) {
        throw new DocumentExtractionError(
          'No readable text was found in this image. Try a clearer, well-lit photo of the document.',
        );
      }
      return trimmed;
    } catch (err: any) {
      if (err instanceof DocumentExtractionError) throw err;
      throw new DocumentExtractionError(
        `Could not read text from this image: ${err?.message || 'unknown error'}`,
      );
    }
  }

  throw new DocumentExtractionError(`Unsupported file type: ${mimeType}`);
}
