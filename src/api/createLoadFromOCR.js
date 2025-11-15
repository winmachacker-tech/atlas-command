import { supabase } from '../lib/supabase';

/**
 * Creates a load in Supabase from OCR-extracted rate confirmation data
 * @param {Object} ocrData - The extracted data from processRateConfirmation
 * @returns {Promise<Object>} The created load record
 */
export async function createLoadFromOCR(ocrData) {
  try {
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error('Not authenticated');

    // Extract pickup and delivery stops
    const pickupStop = ocrData.stops?.find(s => s.type === 'pickup');
    const deliveryStop = ocrData.stops?.find(s => s.type === 'delivery');

    // Parse dates and times from stops
    let pickup_date = null;
    let pickup_time = null;
    let delivery_date = null;
    let delivery_time = null;

    if (pickupStop?.appointment) {
      const pickupDt = new Date(pickupStop.appointment);
      pickup_date = pickupDt.toISOString().split('T')[0]; // YYYY-MM-DD
      pickup_time = pickupDt.toTimeString().split(' ')[0].substring(0, 5); // HH:MM
    }

    if (deliveryStop?.appointment) {
      const deliveryDt = new Date(deliveryStop.appointment);
      delivery_date = deliveryDt.toISOString().split('T')[0];
      delivery_time = deliveryDt.toTimeString().split(' ')[0].substring(0, 5);
    }

    // Build origin and destination strings
    const origin = pickupStop 
      ? `${pickupStop.city}, ${pickupStop.state} ${pickupStop.zip}`.trim()
      : null;
    
    const destination = deliveryStop
      ? `${deliveryStop.city}, ${deliveryStop.state} ${deliveryStop.zip}`.trim()
      : null;

    // Build special instructions combining all relevant info
    const instructionsParts = [];
    
    if (ocrData.special_requirements?.length > 0) {
      instructionsParts.push('REQUIREMENTS:\n' + ocrData.special_requirements.map(r => `• ${r}`).join('\n'));
    }
    
    if (ocrData.warnings?.length > 0) {
      instructionsParts.push('⚠️ WARNINGS:\n' + ocrData.warnings.map(w => `• ${w}`).join('\n'));
    }
    
    if (pickupStop?.special_instructions) {
      instructionsParts.push('PICKUP NOTES:\n' + pickupStop.special_instructions);
    }
    
    if (deliveryStop?.special_instructions) {
      instructionsParts.push('DELIVERY NOTES:\n' + deliveryStop.special_instructions);
    }

    const special_instructions = instructionsParts.length > 0 
      ? instructionsParts.join('\n\n')
      : null;

    // Build notes field with reference numbers
    const notesParts = [];
    
    if (pickupStop?.reference_numbers?.length > 0) {
      notesParts.push('Pickup Refs: ' + pickupStop.reference_numbers.join(', '));
    }
    
    if (deliveryStop?.reference_numbers?.length > 0) {
      notesParts.push('Delivery Refs: ' + deliveryStop.reference_numbers.join(', '));
    }

    const notes = notesParts.length > 0 ? notesParts.join('\n') : null;

    // Format temperature
    let temperature = null;
    if (ocrData.temperature) {
      if (ocrData.temperature.reefer_temp) {
        temperature = `${ocrData.temperature.reefer_temp}°F`;
        if (ocrData.temperature.mode) {
          temperature = `${ocrData.temperature.mode} - ${temperature}`;
        }
      } else if (ocrData.temperature.mode) {
        temperature = ocrData.temperature.mode;
      }
    }

    // Enhanced equipment type mapping with fuzzy matching
    function mapEquipmentType(equipment) {
      if (!equipment) return null;
      
      const normalized = equipment.toLowerCase().trim();
      
      // Exact and partial matches
      const equipmentMap = {
        'dry van': 'DRY_VAN',
        'dry': 'DRY_VAN',
        'van': 'DRY_VAN',
        'reefer': 'REEFER',
        'refrigerated': 'REEFER',
        'temp control': 'REEFER',
        'flatbed': 'FLATBED',
        'flat bed': 'FLATBED',
        'flat': 'FLATBED',
        'step deck': 'STEP_DECK',
        'stepdeck': 'STEP_DECK',
        'step': 'STEP_DECK',
        'lowboy': 'LOWBOY',
        'low boy': 'LOWBOY',
        'power only': 'POWER_ONLY',
        'power': 'POWER_ONLY',
        'box truck': 'BOX_TRUCK',
        'box': 'BOX_TRUCK',
        'straight truck': 'BOX_TRUCK',
      };
      
      // Direct match
      if (equipmentMap[normalized]) {
        return equipmentMap[normalized];
      }
      
      // Partial match
      for (const [key, value] of Object.entries(equipmentMap)) {
        if (normalized.includes(key) || key.includes(normalized)) {
          return value;
        }
      }
      
      return null;
    }
    
    const equipment_type = mapEquipmentType(ocrData.equipment);

    // Get reference/load number (try multiple fields)
    const loadNumber = ocrData.load_number || ocrData.loadNumber || ocrData.reference || null;

    // Build the load object
    const loadData = {
      // Basic info & References - set all three reference fields
      load_number: loadNumber,
      reference: loadNumber,
      ref_no: loadNumber, // This has a unique constraint, so might fail if duplicate
      status: 'AVAILABLE',
      created_by: user.id,
      // org_id will use database default
      
      // Broker/Customer
      broker_name: ocrData.broker?.name || null,
      customer: ocrData.broker?.name || null, // Could also be used as customer
      
      // Locations
      origin: origin,
      origin_city: pickupStop?.city || null,
      origin_state: pickupStop?.state || null,
      destination: destination,
      dest_city: deliveryStop?.city || null,
      dest_state: deliveryStop?.state || null,
      
      // Shipper info
      shipper_name: pickupStop?.facility_name || null,
      shipper: pickupStop?.facility_name || null,
      
      // Consignee info
      consignee_name: deliveryStop?.facility_name || null,
      
      // Pickup details
      pickup_date: pickup_date,
      pickup_time: pickup_time,
      pickup_at: pickupStop?.appointment ? new Date(pickupStop.appointment).toISOString() : null,
      
      // Delivery details
      delivery_date: delivery_date,
      delivery_time: delivery_time,
      delivery_at: deliveryStop?.appointment ? new Date(deliveryStop.appointment).toISOString() : null,
      
      // Contact info
      shipper_contact_name: pickupStop?.facility_name || null,
      shipper_contact_phone: null, // OCR doesn't extract this from stops
      shipper_contact_email: null,
      receiver_contact_name: deliveryStop?.facility_name || null,
      receiver_contact_phone: null,
      receiver_contact_email: null,
      
      // Load details
      commodity: ocrData.commodity || null,
      equipment_type: equipment_type,
      temperature: temperature,
      special_instructions: special_instructions,
      notes: notes,
      
      // Financial
      rate: ocrData.rate || null,
      
      // Driver assignment
      driver_id: null, // Unassigned - dispatch will assign later
      
      // Timestamps
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Insert the load
    const { data: newLoad, error: insertError } = await supabase
      .from('loads')
      .insert([loadData])
      .select()
      .single();

    if (insertError) {
      console.error('Load insertion error:', insertError);
      throw insertError;
    }

    console.log('✅ Load created successfully:', newLoad.id);
    console.log('  Load Number:', newLoad.load_number);
    console.log('  Equipment:', newLoad.equipment_type);
    return newLoad;

  } catch (error) {
    console.error('Error creating load from OCR:', error);
    throw error;
  }
}