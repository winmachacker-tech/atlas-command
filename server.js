// server.js - Local development server for OCR
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const app = express();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

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

// OCR extraction
async function extractTextFromDocument(fileBuffer) {
  const client = getVisionClient();
  
  const [result] = await client.documentTextDetection({
    image: { content: fileBuffer.toString('base64') },
  });

  const fullTextAnnotation = result.fullTextAnnotation;
  if (!fullTextAnnotation?.text) {
    throw new Error('No text detected');
  }

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

  return {
    fullText: fullTextAnnotation.text,
    confidence: blockCount > 0 ? totalConfidence / blockCount : 0,
    detectedLanguage: result.textAnnotations?.[0]?.locale || 'en',
  };
}

// Parsing functions
function parseDocumentByType(fullText, documentType) {
  const parsers = {
    BOL: parseBOL,
    RATE_CONFIRMATION: parseRateConfirmation,
    POD: parsePOD,
    DRIVER_LICENSE: parseDriverLicense,
    INSURANCE: parseInsurance,
    INVOICE: parseInvoice,
  };
  return parsers[documentType]?.(fullText) || { fullText };
}

function parseBOL(text) {
  return {
    documentType: 'BOL',
    bolNumber: text.match(/(?:BOL|B\/L|BILL OF LADING)\s*#?\s*:?\s*([A-Z0-9-]+)/i)?.[1],
    proNumber: text.match(/(?:PRO|PRO#)\s*:?\s*([A-Z0-9-]+)/i)?.[1],
    dates: text.match(/(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/g) || [],
    weight: text.match(/(?:weight|wt\.?)\s*:?\s*([\d,]+)\s*(lbs?|pounds?|kg)?/i)?.[1]?.replace(/,/g, ''),
    pieces: parseInt(text.match(/(?:pieces|pcs|pallets|skids)\s*:?\s*(\d+)/i)?.[1]) || null,
    rawText: text,
  };
}

function parseRateConfirmation(text) {
  return {
    documentType: 'RATE_CONFIRMATION',
    rate: parseFloat(text.match(/(?:rate|total)\s*:?\s*\$?\s*([\d,]+\.?\d*)/i)?.[1]?.replace(/,/g, '')) || null,
    loadNumber: text.match(/(?:load|ref|reference)\s*#?\s*:?\s*([A-Z0-9-]+)/i)?.[1],
    pickupDate: text.match(/(?:pickup|pick up|pu)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1],
    deliveryDate: text.match(/(?:delivery|deliver|del)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1],
    rawText: text,
  };
}

function parsePOD(text) {
  return {
    documentType: 'POD',
    deliveryDate: text.match(/(?:delivered|delivery date)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1],
    deliveryTime: text.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i)?.[1],
    receiverName: text.match(/(?:received by|receiver|signature)\s*:?\s*([A-Za-z\s]+)/i)?.[1]?.trim(),
    rawText: text,
  };
}

function parseDriverLicense(text) {
  return {
    documentType: 'DRIVER_LICENSE',
    licenseNumber: text.match(/(?:license|lic|dl)\s*#?\s*:?\s*([A-Z0-9-]+)/i)?.[1],
    expirationDate: text.match(/(?:exp|expires|expiration)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1],
    dateOfBirth: text.match(/(?:dob|date of birth|birth date)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1],
    rawText: text,
  };
}

function parseInsurance(text) {
  return {
    documentType: 'INSURANCE',
    policyNumber: text.match(/(?:policy|pol)\s*#?\s*:?\s*([A-Z0-9-]+)/i)?.[1],
    expirationDate: text.match(/(?:exp|expires|expiration)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1],
    coverageAmount: parseFloat(text.match(/(?:coverage|liability|limit)\s*:?\s*\$?\s*([\d,]+)/i)?.[1]?.replace(/,/g, '')) || null,
    rawText: text,
  };
}

function parseInvoice(text) {
  return {
    documentType: 'INVOICE',
    invoiceNumber: text.match(/(?:invoice|inv)\s*#?\s*:?\s*([A-Z0-9-]+)/i)?.[1],
    invoiceDate: text.match(/(?:invoice date|date)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1],
    dueDate: text.match(/(?:due date|due)\s*:?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i)?.[1],
    totalAmount: parseFloat(text.match(/(?:total|amount due|balance)\s*:?\s*\$?\s*([\d,]+\.?\d*)/i)?.[1]?.replace(/,/g, '')) || null,
    rawText: text,
  };
}

// API endpoint
app.post('/api/ocr', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    const buffer = fs.readFileSync(req.file.path);
    const ocrResult = await extractTextFromDocument(buffer);

    let structuredData = null;
    if (req.body.documentType && req.body.documentType !== 'UNKNOWN') {
      structuredData = parseDocumentByType(ocrResult.fullText, req.body.documentType);
    }

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      data: {
        fullText: ocrResult.fullText,
        confidence: ocrResult.confidence,
        detectedLanguage: ocrResult.detectedLanguage,
        structuredData,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
      },
    });
  } catch (error) {
    console.error('OCR Error:', error);
    res.status(500).json({ error: 'Failed to process document', details: error.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🚀 OCR API server running on http://localhost:${PORT}`);
});