// app/api/ocr/route.ts
// API endpoint for uploading and processing documents with OCR

import { NextRequest, NextResponse } from 'next/server';
import { extractTextFromDocument, parseDocumentByType } from '@/lib/ocr-service';

export const runtime = 'nodejs';
export const maxDuration = 30; // 30 seconds timeout for OCR processing

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const documentType = formData.get('documentType') as string;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'application/pdf',
    ];

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload an image (JPG, PNG, WEBP) or PDF.' },
        { status: 400 }
      );
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 10MB.' },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Extract text using OCR
    const ocrResult = await extractTextFromDocument(buffer, file.type);

    // Parse based on document type if specified
    let structuredData = null;
    if (documentType && documentType !== 'UNKNOWN') {
      structuredData = await parseDocumentByType(
        ocrResult.fullText,
        documentType as any
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        fullText: ocrResult.fullText,
        confidence: ocrResult.confidence,
        detectedLanguage: ocrResult.detectedLanguage,
        structuredData,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
      },
    });
  } catch (error) {
    console.error('OCR API Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to process document',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}