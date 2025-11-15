// FILE: src/lib/documentExtraction.js
// Purpose: Helper utilities for AI document extraction
// - Simple API wrapper for calling the edge function
// - Type definitions and validation
// - Error handling

import { supabase } from "./supabase";

/**
 * Extract data from a document using AI
 * @param {Object} options - Extraction options
 * @param {string} options.filePath - Full path to file in storage (e.g., "load_docs/load-id/file.pdf")
 * @param {string} [options.loadId] - Optional load ID to associate extraction with
 * @param {string} [options.extractionType] - Type hint: "auto" | "bol" | "rate_confirmation" | "invoice" | "pod"
 * @returns {Promise<Object>} Extraction result
 */
export async function extractDocument({ filePath, loadId, extractionType = "auto" }) {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      throw new Error("Supabase configuration missing");
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/extract-document`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        filePath,
        loadId,
        extractionType,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || "Extraction failed");
    }

    return result.data;
  } catch (error) {
    console.error("Document extraction error:", error);
    throw error;
  }
}

/**
 * Get extraction history for a load
 * @param {string} loadId - Load ID
 * @returns {Promise<Array>} Array of extraction records
 */
export async function getExtractionHistory(loadId) {
  const { data, error } = await supabase
    .from("document_extractions")
    .select("*")
    .eq("load_id", loadId)
    .order("extracted_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Get the most recent extraction for a load
 * @param {string} loadId - Load ID
 * @returns {Promise<Object|null>} Most recent extraction or null
 */
export async function getLatestExtraction(loadId) {
  const { data, error } = await supabase
    .from("document_extractions")
    .select("*")
    .eq("load_id", loadId)
    .order("extracted_at", { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") throw error; // PGRST116 = no rows
  return data || null;
}

/**
 * Format confidence score with color
 * @param {number} confidence - Confidence score (0-100)
 * @returns {Object} { text, color, emoji }
 */
export function formatConfidence(confidence) {
  if (confidence >= 90) {
    return { text: "Excellent", color: "emerald", emoji: "🎯" };
  } else if (confidence >= 75) {
    return { text: "Good", color: "green", emoji: "✅" };
  } else if (confidence >= 60) {
    return { text: "Fair", color: "amber", emoji: "⚠️" };
  } else {
    return { text: "Low", color: "rose", emoji: "❌" };
  }
}

/**
 * Format document type for display
 * @param {string} docType - Document type from extraction
 * @returns {string} Formatted document type
 */
export function formatDocumentType(docType) {
  const types = {
    BOL: "Bill of Lading",
    RATE_CONFIRMATION: "Rate Confirmation",
    INVOICE: "Invoice",
    POD: "Proof of Delivery",
    LUMPER_RECEIPT: "Lumper Receipt",
    OTHER: "Other Document",
  };
  return types[docType] || docType;
}

/**
 * Apply extracted data to a load object (for form auto-fill)
 * @param {Object} load - Current load object
 * @param {Object} extractedData - Extracted data from AI
 * @param {number} minConfidence - Minimum confidence to apply (default: 75)
 * @returns {Object} Updated load object
 */
export function applyExtractedData(load, extractedData, minConfidence = 75) {
  if (!extractedData || extractedData.confidence < minConfidence) {
    return load;
  }

  const updated = { ...load };

  // Apply reference numbers
  if (extractedData.loadDetails?.referenceNumber) {
    updated.customer_ref_no = extractedData.loadDetails.referenceNumber;
  }

  // Apply pickup details
  if (extractedData.pickup?.city) updated.origin_city = extractedData.pickup.city;
  if (extractedData.pickup?.state) updated.origin_state = extractedData.pickup.state;
  if (extractedData.pickup?.appointmentDate) updated.pickup_date = extractedData.pickup.appointmentDate;
  if (extractedData.pickup?.appointmentTime) updated.pickup_time = extractedData.pickup.appointmentTime;

  // Apply delivery details
  if (extractedData.delivery?.city) updated.destination_city = extractedData.delivery.city;
  if (extractedData.delivery?.state) updated.destination_state = extractedData.delivery.state;
  if (extractedData.delivery?.appointmentDate) updated.delivery_date = extractedData.delivery.appointmentDate;
  if (extractedData.delivery?.appointmentTime) updated.delivery_time = extractedData.delivery.appointmentTime;

  // Apply shipment details
  if (extractedData.shipment?.equipmentType) updated.equipment_type = extractedData.shipment.equipmentType;
  if (extractedData.shipment?.weight) updated.weight = extractedData.shipment.weight;
  if (extractedData.shipment?.commodity) updated.commodity = extractedData.shipment.commodity;

  // Apply financial details
  if (extractedData.charges?.totalCharges) updated.total_rate = extractedData.charges.totalCharges;

  return updated;
}

/**
 * Validate extracted data for completeness
 * @param {Object} extractedData - Extracted data
 * @returns {Object} { isValid, missingFields, warnings }
 */
export function validateExtraction(extractedData) {
  const requiredFields = [
    "pickup.city",
    "pickup.state",
    "delivery.city",
    "delivery.state",
  ];

  const missingFields = [];
  const warnings = [];

  // Check required fields
  for (const field of requiredFields) {
    const [section, key] = field.split(".");
    if (!extractedData[section]?.[key]) {
      missingFields.push(field);
    }
  }

  // Check confidence
  if (extractedData.confidence < 60) {
    warnings.push("Low confidence score - manual review recommended");
  }

  // Check for risk flags
  if (extractedData.aiInsights?.riskFlags?.length > 0) {
    warnings.push(`${extractedData.aiInsights.riskFlags.length} risk flag(s) detected`);
  }

  // Check completeness
  if (extractedData.aiInsights?.completeness < 70) {
    warnings.push("Document appears incomplete");
  }

  return {
    isValid: missingFields.length === 0,
    missingFields,
    warnings,
  };
}

/**
 * Export extraction to JSON file
 * @param {Object} extractedData - Extracted data
 * @param {string} filename - Output filename
 */
export function exportToJSON(extractedData, filename = "extraction.json") {
  const dataStr = JSON.stringify(extractedData, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Copy extraction to clipboard
 * @param {Object} extractedData - Extracted data
 * @returns {Promise<void>}
 */
export async function copyToClipboard(extractedData) {
  const text = JSON.stringify(extractedData, null, 2);
  await navigator.clipboard.writeText(text);
}