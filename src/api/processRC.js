// BROWSER-COMPATIBLE PDF Processing + Image OCR
// Uses PDF.js for PDFs and your OCR API for images

import * as pdfjsLib from 'pdfjs-dist';
// Import the worker from the installed package
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure worker - use the local worker from node_modules
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export async function extractTextFromPDF(file) {
  try {
    // Convert file to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    
    // Load PDF
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    console.log(`PDF has ${pdf.numPages} page(s)`);
    
    // Extract text from all pages
    let fullText = '';
    
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      // Combine all text items
      const pageText = textContent.items
        .map(item => item.str)
        .join(' ');
      
      fullText += pageText + '\n\n';
      console.log(`✓ Extracted page ${pageNum}`);
    }
    
    return fullText.trim();
    
  } catch (error) {
    console.error('PDF extraction failed:', error);
    throw new Error(`Failed to extract PDF text: ${error.message}`);
  }
}

// Extract text from images using your OCR API
async function extractTextFromImage(file) {
  try {
    console.log('📷 Extracting text from image using OCR...');
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentType', 'RATE_CONFIRMATION');

    const response = await fetch('http://localhost:3001/api/ocr', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'OCR failed');
    }

    const result = await response.json();
    console.log(`✓ Extracted ${result.data.fullText.length} characters from image`);
    
    return result.data.fullText;
    
  } catch (error) {
    console.error('Image OCR extraction failed:', error);
    throw new Error(`Failed to extract text from image: ${error.message}`);
  }
}

export async function processRateConfirmation(fileOrFormData) {
  // Extract the actual file from FormData if that's what we received
  let file;
  
  if (fileOrFormData instanceof FormData) {
    file = fileOrFormData.get('file');
  } else {
    file = fileOrFormData;
  }
  
  // Validate file type
  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp'
  ];
  
  if (!file || !allowedTypes.includes(file.type)) {
    throw new Error('Please provide a valid PDF or image file (JPG, PNG, WEBP)');
  }
  
  // Step 1: Extract text from PDF or Image
  let extractedText;
  
  if (file.type === 'application/pdf') {
    console.log('📄 Extracting text from PDF...');
    extractedText = await extractTextFromPDF(file);
  } else {
    console.log('📷 Extracting text from image...');
    extractedText = await extractTextFromImage(file);
  }
  
  console.log(`✓ Extracted ${extractedText.length} characters`);
  
  if (!extractedText || extractedText.length < 100) {
    throw new Error('Document appears to be empty or unreadable');
  }
  
  // Step 2: Send to OpenAI
  console.log('🤖 Sending to OpenAI...');
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a freight dispatch assistant. Extract ALL information from this rate confirmation text and return ONLY valid JSON with NO other text.

REQUIRED JSON FORMAT:
{
  "load_number": "string",
  "broker": {
    "name": "string",
    "contact": "string or null",
    "phone": "string or null",
    "email": "string or null"
  },
  "carrier": {
    "name": "string",
    "mc_number": "string",
    "dot_number": "string"
  },
  "commodity": "string",
  "equipment": "string",
  "rate": number,
  "temperature": {
    "mode": "string or null",
    "reefer_temp": "number or null",
    "product_temp": "number or null"
  },
  "stops": [
    {
      "type": "pickup" or "delivery",
      "stop_number": number (1, 2, 3, 4),
      "appointment": "YYYY-MM-DDTHH:mm:ss format",
      "strict": boolean,
      "facility_name": "string",
      "address": "string",
      "city": "string",
      "state": "string (2 letter code)",
      "zip": "string",
      "reference_numbers": ["array of strings like PU#, CONF#, etc"],
      "special_instructions": "string or null"
    }
  ],
  "special_requirements": ["array of strings"],
  "warnings": ["array of critical warnings - especially fines!"]
}

CRITICAL INSTRUCTIONS:
- Extract ALL stops in the correct order (pickup first, then deliveries)
- Capture ALL warnings about fines (like Walmart early delivery penalties)
- Parse appointment times into ISO 8601 format (YYYY-MM-DDTHH:mm:ss)
- Include temperature requirements if this is a reefer load
- Extract all reference numbers (PU#, CONF#, Load ID#, etc)
- Return ONLY the JSON object, absolutely nothing else`
        },
        {
          role: 'user',
          content: `Extract all information from this rate confirmation text:\n\n${extractedText}`
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 3000,
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error('OpenAI error:', errorData);
    throw new Error(`OpenAI API failed: ${errorData.error?.message || response.statusText}`);
  }

  const result = await response.json();
  console.log('✓ OpenAI response received');
  
  // Parse the JSON response
  let extractedData;
  try {
    const content = result.choices[0].message.content;
    extractedData = JSON.parse(content);
  } catch (error) {
    console.error('Failed to parse response:', result.choices[0].message.content);
    throw new Error('OpenAI returned invalid JSON. Please try again.');
  }

  // Basic validation
  if (!extractedData.load_number || !extractedData.stops || extractedData.stops.length === 0) {
    throw new Error('Extracted data is incomplete. Please check the document and try again.');
  }

  console.log('✓ Successfully extracted load data');
  console.log('  Load:', extractedData.load_number);
  console.log('  Stops:', extractedData.stops.length);
  console.log('  Rate:', extractedData.rate);
  
  return extractedData;
}