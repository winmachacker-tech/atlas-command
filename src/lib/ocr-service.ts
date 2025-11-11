// lib/ocr-service.ts
// This service handles OCR processing using Google Cloud Vision API

import { ImageAnnotatorClient } from '@google-cloud/vision';

// Initialize the Vision API client
// This will use the credentials from the environment variable
let visionClient: ImageAnnotatorClient | null = null;

function getVisionClient() {
  if (!visionClient) {
    // Check if we're in a serverless environment (Vercel, etc.)
    if (process.env.GOOGLE_CLOUD_VISION_CREDENTIALS) {
      const credentials = JSON.parse(process.env.GOOGLE_CLOUD_VISION_CREDENTIALS);
      visionClient = new ImageAnnotatorClient({ credentials });
    } else {
      // For local development with a service account file
      visionClient = new ImageAnnotatorClient({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      });
    }
  }
  return visionClient;
}

export interface OCRResult {
  fullText: string;
  confidence: number;
  detectedLanguage?: string;
  structuredData?: any;
}

/**
 * Extract text from an image or PDF using Google Cloud Vision
 * @param fileBuffer - Buffer of the image or PDF file
 * @param mimeType - MIME type of the file (e.g., 'image/jpeg', 'application/pdf')
 */
export async function extractTextFromDocument(
  fileBuffer: Buffer,
  mimeType: string
): Promise<OCRResult> {
  try {
    const client = getVisionClient();

    // Perform OCR on the document
    const [result] = await client.documentTextDetection({
      image: {
        content: fileBuffer.toString('base64'),
      },
    });

    const fullTextAnnotation = result.fullTextAnnotation;

    if (!fullTextAnnotation || !fullTextAnnotation.text) {
      throw new Error('No text detected in document');
    }

    // Calculate average confidence
    const pages = fullTextAnnotation.pages || [];
    let totalConfidence = 0;
    let blockCount = 0;

    pages.forEach(page => {
      page.blocks?.forEach(block => {
        if (block.confidence) {
          totalConfidence += block.confidence;
          blockCount++;
        }
      });
    });

    const averageConfidence = blockCount > 0 ? totalConfidence / blockCount : 0;

    // Detect language
    const detectedLanguages = result.textAnnotations?.[0]?.locale;

    return {
      fullText: fullTextAnnotation.text,
      confidence: averageConfidence,
      detectedLanguage: detectedLanguages || 'en',
    };
  } catch (error) {
    console.error('OCR Error:', error);
    throw new Error(`Failed to extract text: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Parse extracted text based on document type
 * Uses pattern matching and AI to extract structured data
 */
export async function parseDocumentByType(
  fullText: string,
  documentType: 'BOL' | 'RATE_CONFIRMATION' | 'POD' | 'DRIVER_LICENSE' | 'INSURANCE' | 'INVOICE'
): Promise<any> {
  // This is where we'll use pattern matching to extract fields
  // For now, we'll return the basic parsing logic
  // You can enhance this with Claude API calls for smarter extraction

  switch (documentType) {
    case 'BOL':
      return parseBOL(fullText);
    case 'RATE_CONFIRMATION':
      return parseRateConfirmation(fullText);
    case 'POD':
      return parsePOD(fullText);
    case 'DRIVER_LICENSE':
      return parseDriverLicense(fullText);
    case 'INSURANCE':
      return parseInsurance(fullText);
    case 'INVOICE':
      return parseInvoice(fullText);
    default:
      return { fullText };
  }
}

// Helper functions for parsing different document types

function parseBOL(text: string) {
  // Common BOL patterns
  const bolNumber = text.match(/(?:BOL|B\/L|BILL OF LADING)\s*#?\s*:?\s*([A-Z0-9-]+)/i)?.[1];
  const proNumber = text.match(/(?:PRO|PRO#)\s*:?\s*([A-Z0-9-]+)/i)?.[1];
  
  // Date patterns
  const datePattern = /(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/g;
  const dates = text.match(datePattern) || [];
  
  // Weight patterns
  const weight = text.match(/(?:weight|wt\.?)\s*:?\s*([\d,]+)\s*(lbs?|pounds?|kg)?/i)?.[1];
  
  // Pieces/Pallets
  const pieces = text.match(/(?:pieces|pcs|pallets|skids)\s*:?\s*(\d+)/i)?.[1];

  return {
    documentType: 'BOL',
    bolNumber,
    proNumber,
    dates,
    weight: weight ? weight.replace(/,/g, '') : null,
    pieces: pieces ? parseInt(pieces) : null,
    rawText: text,
  };
}

function parseRateConfirmation(text: string) {
  // Rate patterns
  const rate = text.match(/(?:rate|total)\s*:?\s*\$?\s*([\d,]+\.?\d*)/i)?.[1];
  
  // Load number
  const loadNumber = text.match(/(?:load|ref|reference)\s*#?\s*:?\s*([A-Z0-9-]+)/i)?.[1];
  
  // Pickup date
  const pickupDate = text.match(/(?:pickup|pick up|pu)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1];
  
  // Delivery date
  const deliveryDate = text.match(/(?:delivery|deliver|del)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1];

  return {
    documentType: 'RATE_CONFIRMATION',
    rate: rate ? parseFloat(rate.replace(/,/g, '')) : null,
    loadNumber,
    pickupDate,
    deliveryDate,
    rawText: text,
  };
}

function parsePOD(text: string) {
  // Delivery date/time
  const deliveryDate = text.match(/(?:delivered|delivery date)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1];
  const deliveryTime = text.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i)?.[1];
  
  // Receiver name
  const receiverName = text.match(/(?:received by|receiver|signature)\s*:?\s*([A-Za-z\s]+)/i)?.[1];

  return {
    documentType: 'POD',
    deliveryDate,
    deliveryTime,
    receiverName: receiverName?.trim(),
    rawText: text,
  };
}

function parseDriverLicense(text: string) {
  // License number (varies by state)
  const licenseNumber = text.match(/(?:license|lic|dl)\s*#?\s*:?\s*([A-Z0-9-]+)/i)?.[1];
  
  // Expiration date
  const expirationDate = text.match(/(?:exp|expires|expiration)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1];
  
  // DOB
  const dob = text.match(/(?:dob|date of birth|birth date)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1];

  return {
    documentType: 'DRIVER_LICENSE',
    licenseNumber,
    expirationDate,
    dateOfBirth: dob,
    rawText: text,
  };
}

function parseInsurance(text: string) {
  // Policy number
  const policyNumber = text.match(/(?:policy|pol)\s*#?\s*:?\s*([A-Z0-9-]+)/i)?.[1];
  
  // Expiration
  const expirationDate = text.match(/(?:exp|expires|expiration)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1];
  
  // Coverage amount
  const coverage = text.match(/(?:coverage|liability|limit)\s*:?\s*\$?\s*([\d,]+)/i)?.[1];

  return {
    documentType: 'INSURANCE',
    policyNumber,
    expirationDate,
    coverageAmount: coverage ? parseFloat(coverage.replace(/,/g, '')) : null,
    rawText: text,
  };
}

function parseInvoice(text: string) {
  // Invoice number
  const invoiceNumber = text.match(/(?:invoice|inv)\s*#?\s*:?\s*([A-Z0-9-]+)/i)?.[1];
  
  // Invoice date
  const invoiceDate = text.match(/(?:invoice date|date)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1];
  
  // Due date
  const dueDate = text.match(/(?:due date|due)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1];
  
  // Total amount
  const total = text.match(/(?:total|amount due|balance)\s*:?\s*\$?\s*([\d,]+\.?\d*)/i)?.[1];

  return {
    documentType: 'INVOICE',
    invoiceNumber,
    invoiceDate,
    dueDate,
    totalAmount: total ? parseFloat(total.replace(/,/g, '')) : null,
    rawText: text,
  };
}
