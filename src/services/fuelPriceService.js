import { supabase } from '../lib/supabase';

/**
 * Get the latest diesel fuel price from the database
 * @returns {Promise<{price: number, effectiveDate: string} | null>}
 */
export async function getLatestDieselPrice() {
  try {
    const { data, error } = await supabase
      .from('fuel_prices')
      .select('price_per_gallon, effective_date')
      .eq('region', 'US_NATIONAL')
      .order('effective_date', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      console.error('Error fetching latest diesel price:', error);
      return null;
    }

    return {
      price: parseFloat(data.price_per_gallon),
      effectiveDate: data.effective_date,
    };
  } catch (error) {
    console.error('Error in getLatestDieselPrice:', error);
    return null;
  }
}

/**
 * Manually trigger the EIA price fetch
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export async function fetchLatestDieselPrice() {
  try {
    const { data, error } = await supabase.functions.invoke('fetch-eia-diesel-price');

    if (error) {
      console.error('Error invoking fetch-eia-diesel-price function:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (error) {
    console.error('Error in fetchLatestDieselPrice:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Calculate fuel cost for a load based on miles and current diesel price
 * @param {number} miles - Total miles for the load
 * @param {number} truckMPG - Truck fuel efficiency (default 6.5 MPG)
 * @returns {Promise<{fuelCost: number, gallons: number, pricePerGallon: number}>}
 */
export async function calculateFuelCost(miles, truckMPG = 6.5) {
  const dieselPrice = await getLatestDieselPrice();
  
  // Fallback to $3.87/gallon if no price available
  const pricePerGallon = dieselPrice?.price || 3.87;
  
  const gallons = miles / truckMPG;
  const fuelCost = gallons * pricePerGallon;

  return {
    fuelCost: parseFloat(fuelCost.toFixed(2)),
    gallons: parseFloat(gallons.toFixed(2)),
    pricePerGallon: parseFloat(pricePerGallon.toFixed(2)),
  };
}