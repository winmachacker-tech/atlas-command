// src/services/weatherService.js
const OPENWEATHER_API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY;
const BASE_URL = 'https://api.openweathermap.org/data/2.5';

// Cache to prevent excessive API calls (weather doesn't change that fast)
const weatherCache = new Map();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

/**
 * Check if a string looks like a street address
 */
function looksLikeStreetAddress(str) {
  if (!str) return false;
  const streetPatterns = /^\d+|street|st\b|avenue|ave\b|boulevard|blvd|road|rd\b|drive|dr\b|lane|ln\b|way|court|ct\b|circle|place|pl\b/i;
  return streetPatterns.test(str);
}

/**
 * Parse city and state from a full address
 * @param {string} address - Full address (e.g., "123 Main St,Folsom,CA,US" or "123 Main St\nFolsom,CA,US")
 * @returns {Object} { city, state }
 */
function parseCityState(address) {
  if (!address) return { city: null, state: null };
  
  console.log('[Weather] Parsing address:', address);
  
  // Normalize: replace newlines with commas for consistent parsing
  const normalized = address.replace(/\n/g, ',');
  const parts = normalized.split(',').map(s => s.trim()).filter(Boolean);
  
  if (parts.length === 0) return { city: null, state: null };
  
  // If only one part and it looks like a street address, we can't extract city
  if (parts.length === 1) {
    if (looksLikeStreetAddress(parts[0])) {
      console.warn('[Weather] Single part looks like street address, cannot extract city:', parts[0]);
      return { city: null, state: null };
    }
    return { city: parts[0], state: 'US' };
  }
  
  // Filter out parts that look like street addresses
  const nonStreetParts = parts.filter(p => !looksLikeStreetAddress(p));
  
  console.log('[Weather] Non-street parts:', nonStreetParts);
  
  // If we filtered everything out, try to find city before country code
  if (nonStreetParts.length === 0) {
    // Try to find city before "US" or similar country code
    const countryIndex = parts.findIndex(p => p.toUpperCase() === 'US' || p.toUpperCase() === 'USA');
    if (countryIndex > 0) {
      const cityPart = parts[countryIndex - 1];
      // Make sure it's not a street address
      if (!looksLikeStreetAddress(cityPart)) {
        return { city: cityPart, state: parts[countryIndex + 1] || 'US' };
      }
    }
    
    console.warn('[Weather] Could not extract city from:', address);
    return { city: null, state: null };
  }
  
  // Standard parsing from filtered parts
  // Format is usually: City, State, Country
  const city = nonStreetParts[0];
  const state = nonStreetParts[1] && nonStreetParts[1].toUpperCase() !== 'US' && nonStreetParts[1].toUpperCase() !== 'USA' 
    ? nonStreetParts[1] 
    : null;
  
  console.log('[Weather] Extracted city:', city, 'state:', state);
  
  return { city, state };
}

/**
 * Get weather for a location by city and state
 * @param {string} cityOrAddress - City name or full address
 * @param {string} state - State abbreviation (e.g., "CA") - optional if full address provided
 * @returns {Promise<Object>} Weather data
 */
export async function getWeatherByCity(cityOrAddress, state) {
  if (!OPENWEATHER_API_KEY) {
    console.warn('OpenWeather API key not configured');
    return null;
  }

  // Parse city/state from address if needed
  let city = cityOrAddress;
  let stateCode = state;
  
  // Check if this looks like it needs parsing
  const needsParsing = cityOrAddress && (
    cityOrAddress.includes(',') || 
    cityOrAddress.includes('\n') ||
    looksLikeStreetAddress(cityOrAddress)
  );
  
  if (needsParsing) {
    const parsed = parseCityState(cityOrAddress);
    if (parsed.city) {
      city = parsed.city;
      stateCode = parsed.state || stateCode;
    } else {
      console.warn('[Weather] Failed to parse city from address:', cityOrAddress);
      return null;
    }
  }

  if (!city) {
    console.warn('No city provided for weather lookup');
    return null;
  }

  const cacheKey = `${city},${stateCode || 'US'}`.toLowerCase();
  const cached = weatherCache.get(cacheKey);
  
  // Return cached data if still fresh
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('[Weather] Using cached data for:', cacheKey);
    return cached.data;
  }

  try {
    // Build query - handle US state codes properly
    const query = stateCode && stateCode.length === 2 && stateCode.toUpperCase() !== 'US'
      ? `${city},${stateCode},US`
      : `${city},US`;
      
    const url = `${BASE_URL}/weather?q=${encodeURIComponent(query)}&appid=${OPENWEATHER_API_KEY}&units=imperial`;
    
    console.log(`[Weather] Fetching weather for: ${query}`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Transform to simpler format
    const weather = {
      temp: Math.round(data.main.temp),
      feelsLike: Math.round(data.main.feels_like),
      condition: data.weather[0].main,
      description: data.weather[0].description,
      icon: data.weather[0].icon,
      humidity: data.main.humidity,
      windSpeed: Math.round(data.wind.speed),
      windDirection: data.wind.deg,
      city: data.name,
    };
    
    // Cache the result
    weatherCache.set(cacheKey, {
      data: weather,
      timestamp: Date.now(),
    });
    
    return weather;
  } catch (error) {
    console.error('[Weather] Failed to fetch weather:', error);
    return null;
  }
}

/**
 * Get weather by coordinates (lat/lon)
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {Promise<Object>} Weather data
 */
export async function getWeatherByCoordinates(lat, lon) {
  if (!OPENWEATHER_API_KEY) {
    console.warn('OpenWeather API key not configured');
    return null;
  }

  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = weatherCache.get(cacheKey);
  
  // Return cached data if still fresh
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }

  try {
    const url = `${BASE_URL}/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=imperial`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Transform to simpler format
    const weather = {
      temp: Math.round(data.main.temp),
      feelsLike: Math.round(data.main.feels_like),
      condition: data.weather[0].main,
      description: data.weather[0].description,
      icon: data.weather[0].icon,
      humidity: data.main.humidity,
      windSpeed: Math.round(data.wind.speed),
      windDirection: data.wind.deg,
      city: data.name,
      lat,
      lon,
    };
    
    // Cache the result
    weatherCache.set(cacheKey, {
      data: weather,
      timestamp: Date.now(),
    });
    
    return weather;
  } catch (error) {
    console.error('Failed to fetch weather by coordinates:', error);
    return null;
  }
}

/**
 * Get severity level for alert display
 */
function getSeverityLevel(weather) {
  if (!weather) return 'info';
  
  // Extreme conditions
  if (['Thunderstorm', 'Tornado', 'Hurricane'].includes(weather.condition)) {
    return 'critical';
  }
  
  // Major conditions
  if (weather.condition === 'Snow' || weather.windSpeed > 45) {
    return 'high';
  }
  
  // Moderate conditions
  if (weather.windSpeed > 35 || ['Rain', 'Fog', 'Mist'].includes(weather.condition)) {
    return 'moderate';
  }
  
  return 'info';
}

/**
 * Sample points along route for weather checking
 * Returns pickup, delivery, and midpoint if route is long enough
 */
function getSamplePoints(waypoints) {
  if (!waypoints || waypoints.length < 2) return [];
  
  const samples = [];
  
  // Add pickup
  samples.push({
    ...waypoints[0],
    name: waypoints[0].name || 'Pickup',
  });
  
  // Add midpoint if we have enough waypoints
  if (waypoints.length >= 3) {
    const midIndex = Math.floor(waypoints.length / 2);
    samples.push({
      ...waypoints[midIndex],
      name: waypoints[midIndex].name || 'En Route',
    });
  }
  
  // Add delivery
  samples.push({
    ...waypoints[waypoints.length - 1],
    name: waypoints[waypoints.length - 1].name || 'Delivery',
  });
  
  return samples;
}

/**
 * Get weather alerts along a route
 * @param {Array} waypoints - Array of {lat, lng, name} coordinates
 * @returns {Promise<Array>} Weather alerts with locations
 */
export async function getRouteWeatherAlerts(waypoints) {
  if (!waypoints || waypoints.length < 2) {
    console.log('[RouteWeather] Not enough waypoints');
    return [];
  }
  
  const alerts = [];
  const samplePoints = getSamplePoints(waypoints);
  
  console.log('[RouteWeather] Checking weather at', samplePoints.length, 'points');
  
  // Check weather at each sample point
  for (const point of samplePoints) {
    try {
      const weather = await getWeatherByCoordinates(point.lat, point.lng);
      
      if (!weather) continue;
      
      // Check if this weather is concerning
      if (isSevereWeather(weather)) {
        const severity = getSeverityLevel(weather);
        
        alerts.push({
          location: point.name || `${point.lat.toFixed(2)}, ${point.lng.toFixed(2)}`,
          severity,
          condition: weather.condition,
          description: weather.description,
          windSpeed: weather.windSpeed,
          temp: weather.temp,
          icon: getWeatherEmoji(weather.condition),
          city: weather.city,
        });
        
        console.log(`[RouteWeather] Alert found at ${point.name}:`, severity, weather.condition);
      }
    } catch (error) {
      console.warn(`[RouteWeather] Failed to fetch weather for ${point.name}:`, error);
    }
  }
  
  console.log('[RouteWeather] Total alerts:', alerts.length);
  return alerts;
}

/**
 * Get weather alerts for a location (requires paid API tier)
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {Promise<Array>} Weather alerts
 */
export async function getWeatherAlerts(lat, lon) {
  if (!OPENWEATHER_API_KEY) {
    return [];
  }

  try {
    // Note: OneCall API requires a paid subscription
    const url = `${BASE_URL}/onecall?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&exclude=minutely,hourly,daily`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.alerts || [];
  } catch (error) {
    console.error('Failed to fetch weather alerts:', error);
    return [];
  }
}

/**
 * Get weather icon URL
 * @param {string} iconCode - OpenWeather icon code
 * @returns {string} Icon URL
 */
export function getWeatherIconUrl(iconCode) {
  return `https://openweathermap.org/img/wn/${iconCode}@2x.png`;
}

/**
 * Get weather emoji based on condition
 * @param {string} condition - Weather condition
 * @returns {string} Emoji
 */
export function getWeatherEmoji(condition) {
  const emojiMap = {
    'Clear': '☀️',
    'Clouds': '☁️',
    'Rain': '🌧️',
    'Drizzle': '🌦️',
    'Thunderstorm': '⛈️',
    'Snow': '❄️',
    'Mist': '🌫️',
    'Fog': '🌫️',
    'Haze': '🌫️',
    'Tornado': '🌪️',
    'Hurricane': '🌀',
  };
  
  return emojiMap[condition] || '🌤️';
}

/**
 * Get wind direction as compass point
 * @param {number} degrees - Wind direction in degrees
 * @returns {string} Compass direction (e.g., "NE")
 */
export function getWindDirection(degrees) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

/**
 * Check if weather is severe
 * @param {Object} weather - Weather data
 * @returns {boolean} True if severe weather
 */
export function isSevereWeather(weather) {
  if (!weather) return false;
  
  const severeConditions = ['Thunderstorm', 'Snow', 'Tornado', 'Hurricane'];
  return severeConditions.includes(weather.condition) || weather.windSpeed > 35;
}