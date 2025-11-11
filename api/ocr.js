// api/ocr.js
// Vercel Serverless Function for OCR processing

import { ImageAnnotatorClient } from '@google-cloud/vision';
import formidable from 'formidable';
import fs from 'fs';

// Disable body parsing, we'll handle it with formidable
export const config = {
  api: {
    bodyParser: false,
  },
};

// Initialize Vision API client
let visionClient = null;

function getVisionClient() {
  if (!visionClient) {
    if (process.env.GOOGLE_CLOUD_VISION_CREDENTIALS) {
      const credentials = JSON.parse(process.env.GOOGLE_CLOUD_VISION_CREDENTIALS);
      visionClient = new ImageAnnotatorClient({ credentials });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      visionClient = new ImageAnnotatorClient({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      });
    } else {
      throw new Error('No Google Cloud credentials found');
    }
  }
  return visionClient;
}

// OCR extraction function
async function extractTextFromDocument(fileBuffer, mimeType) {
  try {
    const client = getVisionClient();

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
    const detectedLanguages = result.textAnnotations?.[0]?.locale;

    return {
      fullText: fullTextAnnotation.text,
      confidence: averageConfidence,
      detectedLanguage: detectedLanguages || 'en',
    };
  } catch (error) {
    console.error('OCR Error:', error);
    throw new Error(`Failed to extract text: ${error.message}`);
  }
}

// Parse document based on type
function parseDocumentByType(fullText, documentType) {
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

// Parsing functions
function parseBOL(text) {
  const bolNumber = text.match(/(?:BOL|B\/L|BILL OF LADING)\s*#?\s*:?\s*([A-Z0-9-]+)/i)?.[1];
  const proNumber = text.match(/(?:PRO|PRO#)\s*:?\s*([A-Z0-9-]+)/i)?.[1];
  const datePattern = /(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/g;
  const dates = text.match(datePattern) || [];
  const weight = text.match(/(?:weight|wt\.?)\s*:?\s*([\d,]+)\s*(lbs?|pounds?|kg)?/i)?.[1];
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

function parseRateConfirmation(text) {
  const rate = text.match(/(?:rate|total)\s*:?\s*\$?\s*([\d,]+\.?\d*)/i)?.[1];
  const loadNumber = text.match(/(?:load|ref|reference)\s*#?\s*:?\s*([A-Z0-9-]+)/i)?.[1];
  const pickupDate = text.match(/(?:pickup|pick up|pu)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1];
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

function parsePOD(text) {
  const deliveryDate = text.match(/(?:delivered|delivery date)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1];
  const deliveryTime = text.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i)?.[1];
  const receiverName = text.match(/(?:received by|receiver|signature)\s*:?\s*([A-Za-z\s]+)/i)?.[1];

  return {
    documentType: 'POD',
    deliveryDate,
    deliveryTime,
    receiverName: receiverName?.trim(),
    rawText: text,
  };
}

function parseDriverLicense(text) {
  const licenseNumber = text.match(/(?:license|lic|dl)\s*#?\s*:?\s*([A-Z0-9-]+)/i)?.[1];
  const expirationDate = text.match(/(?:exp|expires|expiration)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1];
  const dob = text.match(/(?:dob|date of birth|birth date)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1];

  return {
    documentType: 'DRIVER_LICENSE',
    licenseNumber,
    expirationDate,
    dateOfBirth: dob,
    rawText: text,
  };
}

function parseInsurance(text) {
  const policyNumber = text.match(/(?:policy|pol)\s*#?\s*:?\s*([A-Z0-9-]+)/i)?.[1];
  const expirationDate = text.match(/(?:exp|expires|expiration)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1];
  const coverage = text.match(/(?:coverage|liability|limit)\s*:?\s*\$?\s*([\d,]+)/i)?.[1];

  return {
    documentType: 'INSURANCE',
    policyNumber,
    expirationDate,
    coverageAmount: coverage ? parseFloat(coverage.replace(/,/g, '')) : null,
    rawText: text,
  };
}

function parseInvoice(text) {
  const invoiceNumber = text.match(/(?:invoice|inv)\s*#?\s*:?\s*([A-Z0-9-]+)/i)?.[1];
  const invoiceDate = text.match(/(?:invoice date|date)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1];
  const dueDate = text.match(/(?:due date|due)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1];
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

// Main handler
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse the multipart form data
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 }); // 10MB max

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        resolve([fields, files]);
      });
    });

    const file = files.file?.[0] || files.file;
    const documentType = fields.documentType?.[0] || fields.documentType || 'UNKNOWN';

    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Validate file type
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'application/pdf',
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({
        error: 'Invalid file type. Please upload an image (JPG, PNG, WEBP) or PDF.',
      });
    }

    // Read file buffer
    const buffer = fs.readFileSync(file.filepath);

    // Extract text using OCR
    const ocrResult = await extractTextFromDocument(buffer, file.mimetype);

    // Parse based on document type
    let structuredData = null;
    if (documentType && documentType !== 'UNKNOWN') {
      structuredData = parseDocumentByType(ocrResult.fullText, documentType);
    }

    return res.status(200).json({
      success: true,
      data: {
        fullText: ocrResult.fullText,
        confidence: ocrResult.confidence,
        detectedLanguage: ocrResult.detectedLanguage,
        structuredData,
        fileName: file.originalFilename,
        fileSize: file.size,
        mimeType: file.mimetype,
      },
    });
  } catch (error) {
    console.error('OCR API Error:', error);
    return res.status(500).json({
      error: 'Failed to process document',
      details: error.message,
    });
  }
}