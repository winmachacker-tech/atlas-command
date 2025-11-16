// FILE: src/api/createLoadFromOCR.js
import { supabase } from '../lib/supabase';

/**
 * Creates a load in Supabase from OCR-extracted rate confirmation data
 * @param {Object} ocrData - The extracted data from processRateConfirmation
 * @returns {Promise<Object>} The created or existing load record
 */
export async function createLoadFromOCR(ocrData) {
  console.log('[OCR] createLoadFromOCR v5 – org-aware + RLS-friendly');

  try {
    // 1) Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) throw userError;
    if (!user) throw new Error('Not authenticated');

    // 2) Get the user's org_id from team_members
    //    This aligns with your tenant model and RLS expectations.
    const { data: membership, error: memberError } = await supabase
      .from('team_members')
      .select('org_id, email, role, status, is_default')
      .eq('user_id', user.id)
      .maybeSingle();

    if (memberError) throw memberError;

    if (!membership?.org_id) {
      throw new Error(
        'Your account is not linked to an organization. Please contact an admin.'
      );
    }

    if (membership.status !== 'active') {
      throw new Error(
        `Your organization membership is not active (status = ${membership.status}).`
      );
    }

    const orgId = membership.org_id;
    console.log('[OCR] Using org_id from team_members:', orgId);

    // 3) Extract pickup and delivery stops
    const pickupStop = ocrData.stops?.find((s) => s.type === 'pickup');
    const deliveryStop = ocrData.stops?.find((s) => s.type === 'delivery');

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
      instructionsParts.push(
        'REQUIREMENTS:\n' +
          ocrData.special_requirements.map((r) => `• ${r}`).join('\n')
      );
    }

    if (ocrData.warnings?.length > 0) {
      instructionsParts.push(
        '⚠️ WARNINGS:\n' + ocrData.warnings.map((w) => `• ${w}`).join('\n')
      );
    }

    if (pickupStop?.special_instructions) {
      instructionsParts.push('PICKUP NOTES:\n' + pickupStop.special_instructions);
    }

    if (deliveryStop?.special_instructions) {
      instructionsParts.push('DELIVERY NOTES:\n' + deliveryStop.special_instructions);
    }

    const special_instructions =
      instructionsParts.length > 0 ? instructionsParts.join('\n\n') : null;

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

      const equipmentMap = {
        'dry van': 'DRY_VAN',
        dry: 'DRY_VAN',
        van: 'DRY_VAN',
        reefer: 'REEFER',
        refrigerated: 'REEFER',
        'temp control': 'REEFER',
        flatbed: 'FLATBED',
        'flat bed': 'FLATBED',
        flat: 'FLATBED',
        'step deck': 'STEP_DECK',
        stepdeck: 'STEP_DECK',
        step: 'STEP_DECK',
        lowboy: 'LOWBOY',
        'low boy': 'LOWBOY',
        'power only': 'POWER_ONLY',
        power: 'POWER_ONLY',
        'box truck': 'BOX_TRUCK',
        box: 'BOX_TRUCK',
        'straight truck': 'BOX_TRUCK',
      };

      if (equipmentMap[normalized]) {
        return equipmentMap[normalized];
      }

      for (const [key, value] of Object.entries(equipmentMap)) {
        if (normalized.includes(key) || key.includes(normalized)) {
          return value;
        }
      }

      return null;
    }

    const equipment_type = mapEquipmentType(ocrData.equipment);

    // Get reference/load number (try multiple fields)
    const loadNumber =
      ocrData.load_number || ocrData.loadNumber || ocrData.reference || null;

    if (!loadNumber) {
      throw new Error('OCR did not return a load number / reference.');
    }

    const nowIso = new Date().toISOString();

    // Build the load object
    // 🔐 IMPORTANT: org_id is set explicitly from team_members,
    //              which should match current_org_id() under your RLS.
    const loadData = {
      org_id: orgId,

      load_number: loadNumber,
      reference: loadNumber,
      ref_no: loadNumber,

      status: 'AVAILABLE',
      created_by: user.id,

      broker_name: ocrData.broker?.name || null,
      customer: ocrData.broker?.name || null,

      origin: origin,
      origin_city: pickupStop?.city || null,
      origin_state: pickupStop?.state || null,
      destination: destination,
      dest_city: deliveryStop?.city || null,
      dest_state: deliveryStop?.state || null,

      shipper_name: pickupStop?.facility_name || null,
      shipper: pickupStop?.facility_name || null,

      consignee_name: deliveryStop?.facility_name || null,

      pickup_date: pickup_date,
      pickup_time: pickup_time,
      pickup_at: pickupStop?.appointment
        ? new Date(pickupStop.appointment).toISOString()
        : null,

      delivery_date: delivery_date,
      delivery_time: delivery_time,
      delivery_at: deliveryStop?.appointment
        ? new Date(deliveryStop.appointment).toISOString()
        : null,

      shipper_contact_name: pickupStop?.facility_name || null,
      shipper_contact_phone: null,
      shipper_contact_email: null,
      receiver_contact_name: deliveryStop?.facility_name || null,
      receiver_contact_phone: null,
      receiver_contact_email: null,

      commodity: ocrData.commodity || null,
      equipment_type: equipment_type,
      temperature: temperature,
      special_instructions: special_instructions,
      notes: notes,

      rate: ocrData.rate || null,
      driver_id: null,

      created_at: nowIso,
      updated_at: nowIso,
    };

    console.log(
      '[OCR] Inserting load with org_id/ref_no:',
      orgId,
      loadNumber
    );

    const { data: newLoad, error: insertError } = await supabase
      .from('loads')
      .insert([loadData])
      .select()
      .single();

    if (insertError) {
      // Duplicate ref_no: try to fetch existing row in this org instead
      if (String(insertError.code) === '23505') {
        console.warn(
          '[OCR] Duplicate ref_no (23505). Trying to load existing row instead.',
          insertError
        );

        const { data: existingLoad, error: fetchError } = await supabase
          .from('loads')
          .select('*')
          .eq('org_id', orgId)
          .eq('ref_no', loadNumber)
          .maybeSingle();

        if (fetchError) {
          console.error(
            '[OCR] Failed to fetch existing load after duplicate error:',
            fetchError
          );
          throw new Error(
            'Load already exists, but could not be loaded. Please open it from the Loads page.'
          );
        }

        if (!existingLoad) {
          console.error(
            '[OCR] Duplicate key error but no existing load visible under RLS.'
          );
          throw insertError;
        }

        console.log(
          '✅ [OCR] Existing load found for duplicate ref_no, returning existing record:',
          existingLoad.id
        );
        return existingLoad;
      }

      console.error('Load insertion error:', insertError);
      throw insertError;
    }

    console.log('✅ [OCR] Load created successfully:', newLoad.id);
    console.log('  Load Number:', newLoad.load_number);
    console.log('  Equipment:', newLoad.equipment_type);
    return newLoad;
  } catch (error) {
    console.error('Error creating load from OCR (v5 org-aware):', error);
    throw error;
  }
}
