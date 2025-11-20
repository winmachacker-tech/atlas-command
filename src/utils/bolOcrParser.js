// src/utils/bolOcrParser.js

// Main entry: called from AddLoadModal / OCR upload
export async function extractRateConfirmationData(file) {
  try {
    // Check if it's a PDF
    if (file.type === "application/pdf") {
      return await extractFromPDF(file);
    } else {
      // Single image
      return await extractFromSingleImage(file);
    }
  } catch (error) {
    console.error("Error extracting rate confirmation data:", error);
    throw error;
  }
}

// Handle PDF with multiple pages
async function extractFromPDF(pdfFile) {
  try {
    // Dynamically import PDF.js
    const pdfjsLib = await import("pdfjs-dist/webpack");

    // Convert PDF file to array buffer
    const arrayBuffer = await pdfFile.arrayBuffer();

    // Load PDF
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;

    console.log(`📄 Processing ${numPages}-page PDF rate confirmation`);

    // Convert each page to image
    const pageImages = [];
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const scale = 2.0; // Higher scale = better quality
      const viewport = page.getViewport({ scale });

      // Create canvas
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      // Render page to canvas
      await page
        .render({
          canvasContext: context,
          viewport: viewport,
        })
        .promise;

      // Convert canvas to base64
      const base64Image = canvas.toDataURL("image/png").split(",")[1];
      pageImages.push(base64Image);

      console.log(`✓ Processed page ${pageNum}/${numPages}`);
    }

    // Send all pages to OpenAI in one request
    return await extractFromMultipleImages(pageImages, numPages);
  } catch (error) {
    console.error("PDF processing error:", error);
    throw new Error("Failed to process PDF. Please try converting to images first.");
  }
}

// Handle single image
async function extractFromSingleImage(imageFile) {
  const base64Image = await fileToBase64(imageFile);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: getExtractionPrompt(1), // Single page
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${imageFile.type};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 2000,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error?.message || `OpenAI API error: ${response.statusText}`,
    );
  }

  const data = await response.json();
  const content = data.choices[0].message.content.trim();

  // Remove markdown code blocks if present
  const jsonContent = content
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  const extractedData = JSON.parse(jsonContent);

  // Clean up numeric fields
  return cleanNumericFields(extractedData);
}

// Handle multiple images (for multi-page PDFs)
async function extractFromMultipleImages(base64Images, pageCount) {
  // Build content array with text prompt + all images
  const content = [
    {
      type: "text",
      text: getExtractionPrompt(pageCount),
    },
  ];

  // Add all page images
  base64Images.forEach((base64Image) => {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${base64Image}`,
        detail: "high", // Important for multi-page documents
      },
    });
  });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: content,
        },
      ],
      max_tokens: 2500, // More tokens for multi-page
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error?.message || `OpenAI API error: ${response.statusText}`,
    );
  }

  const data = await response.json();
  const textContent = data.choices[0].message.content.trim();

  const jsonContent = textContent
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  const extractedData = JSON.parse(jsonContent);

  // Clean up numeric fields
  return cleanNumericFields(extractedData);
}

// Clean up numeric fields - remove commas, dollar signs, etc.
function cleanNumericFields(data) {
  if (!data || typeof data !== "object") return data;

  if (data.weight) {
    data.weight = String(data.weight).replace(/,/g, "");
  }
  if (data.rate) {
    data.rate = String(data.rate).replace(/[$,]/g, "");
  }
  if (data.miles) {
    data.miles = String(data.miles).replace(/,/g, "");
  }
  if (data.rate_per_mile) {
    data.rate_per_mile = String(data.rate_per_mile).replace(/[$,]/g, "");
  }
  if (data.detention_charges) {
    data.detention_charges = String(data.detention_charges).replace(/[$,]/g, "");
  }
  if (data.accessorial_charges) {
    data.accessorial_charges = String(data.accessorial_charges).replace(
      /[$,]/g,
      "",
    );
  }

  // You can extend this later for numeric cleaning inside stops if needed.
  return data;
}

// Generate prompt based on page count
function getExtractionPrompt(pageCount) {
  const multiPageNote =
    pageCount > 1
      ? `\n\nIMPORTANT: This is a ${pageCount}-page document. Look across ALL ${pageCount} pages to find the information. Some details may be on page 1 while others are on page 2 or 3. Combine information from all pages to create a complete extraction.`
      : "";

  // We explicitly ask for nested address objects and single-line addresses
  return `You are extracting data from a trucking RATE CONFIRMATION document sent by a freight broker. These documents contain load details, pricing, and location information.${multiPageNote}

Very important:
- The true pickup and delivery locations are usually labeled as PICKUP, SHIPPER, ORIGIN, STOP, or DELIVERY / CONSIGNEE.
- DO NOT use the broker's remittance, "Send bills to", or payment addresses for origin/destination or stops.
- When in doubt, choose the locations that look like facilities where freight is picked up or delivered (farms, warehouses, shippers, receivers), not offices or PO boxes.

Extract all visible information and return ONLY valid JSON with this exact structure (use null for missing fields):

{
  "reference": "load number or confirmation number",
  "shipper": "shipper/pickup company name (main pickup)",
  "origin": "pickup location as City, ST format (main pickup city/state)",
  "destination": "delivery location as City, ST format (final delivery city/state)",
  "broker_name": "broker or customer company name",

  "pickup_date": "pickup date in YYYY-MM-DD format",
  "pickup_time": "pickup time in HH:MM 24-hour format",
  "delivery_date": "delivery date in YYYY-MM-DD format",
  "delivery_time": "delivery time in HH:MM 24-hour format",

  "shipper_contact_name": "shipper contact person",
  "shipper_contact_phone": "shipper phone number",
  "shipper_contact_email": "shipper email",
  "receiver_contact_name": "consignee/receiver contact person",
  "receiver_contact_phone": "receiver phone number",
  "receiver_contact_email": "receiver email",

  "bol_number": "BOL number if present",
  "po_number": "PO number if present",
  "customer_reference": "any other reference number",
  "commodity": "description of freight/cargo",
  "weight": "weight in pounds as number only",
  "pieces": "number of pallets/pieces as number only",

  "equipment_type": "must be exactly one of: DRY_VAN, REEFER, FLATBED, STEP_DECK, LOWBOY, POWER_ONLY, BOX_TRUCK, OTHER",

  "temperature": "temperature requirement for reefer loads",
  "special_instructions": "special requirements, handling instructions, or notes",

  "miles": "distance in miles as number only",
  "rate": "total rate/pay amount as number only (no $ symbol)",
  "rate_per_mile": "rate per mile as number only",
  "detention_charges": "detention charges as number only",
  "accessorial_charges": "other accessorial charges as number only",

  "pickup_address_full": "single-line pickup address including company, street, city, state, and ZIP if possible (e.g. \\"ABC Foods, 10098-9476 FAIRVIEW DR, HOLLISTER, CA 95023\\")",
  "delivery_address_full": "single-line delivery address including company, street, city, state, and ZIP if possible (e.g. \\"XYZ Warehouse, 317 MAPLE AVE, NEW HAMPTON, NY 10958\\")",

  "pickup_address": {
    "company_name": "pickup facility/company name",
    "address_line1": "street line for pickup (e.g. 10098-9476 FAIRVIEW DR)",
    "address_line2": "suite/building info if present, otherwise null",
    "city": "pickup city",
    "state": "2-letter pickup state code",
    "postal_code": "pickup ZIP/postal code",
    "country": "2-letter country code if clearly visible, else null"
  },

  "delivery_address": {
    "company_name": "delivery facility/company name",
    "address_line1": "street line for delivery (e.g. 317 MAPLE AVE)",
    "address_line2": "suite/building info if present, otherwise null",
    "city": "delivery city",
    "state": "2-letter delivery state code",
    "postal_code": "delivery ZIP/postal code",
    "country": "2-letter country code if clearly visible, else null"
  },

  "stops": [
    {
      "sequence": 1,
      "type": "PICKUP or DELIVERY or STOP",
      "location_name": "facility/company name for this stop",
      "address_line1": "street address line",
      "address_line2": "second line if present, else null",
      "city": "city for this stop",
      "state": "2-letter state code",
      "postal_code": "ZIP/postal code",
      "country": "2-letter country code if clearly visible, else null",
      "scheduled_start": "scheduled start date/time in ISO format YYYY-MM-DDTHH:MM or null",
      "scheduled_end": "scheduled end date/time in ISO format YYYY-MM-DDTHH:MM or null",
      "contact_name": "contact name at this stop if visible",
      "contact_phone": "contact phone at this stop if visible",
      "reference_number": "reference or appointment number for this stop if present",
      "notes": "any notes specific to this stop, or null"
    }
  ]
}

CRITICAL RULES:
- Return ONLY the JSON object, no markdown formatting, no code blocks, no explanations.
- Use null for any field not clearly visible.
- Convert all dates to YYYY-MM-DD format.
- Convert all times to 24-hour HH:MM format.
- Format origin and destination as "City, ST" with 2-letter state codes.
- Equipment type MUST be one of the exact values listed.
- All monetary values and measurements should be numbers only (no $ or commas).
- Origin/destination and the stops array MUST use the actual pickup/delivery locations, NOT the broker's mailing or payment address.
- If there is exactly one pickup and one delivery, the stops array should contain 2 stops: one PICKUP and one DELIVERY.`;
}

// Convert file to base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64 = reader.result;
      const base64Data = base64.split(",")[1];
      resolve(base64Data);
    };
    reader.onerror = (error) => reject(error);
  });
}
