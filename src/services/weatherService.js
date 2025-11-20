// src/services/weatherService.js
const OPENWEATHER_API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY;
const BASE_URL = 'https://api.openweathermap.org/data/2.5';

// Cache to prevent excessive API calls (weather doesn't change that fast)
const weatherCache = new Map();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

/**
 * Parse city and state from a full address
 * @param {string} address - Full address (e.g., "123 Main St\nFolsom,CA,US")
 * @returns {Object} { city, state }
 */
function parseCityState(address) {
  if (!address) return { city: null, state: null };
  
  // If it's already just "City, State" format
  if (!address.includes('\n') && address.includes(',')) {
    const parts = address.split(',').map(s => s.trim());
    return { city: parts[0], state: parts[1] || 'US' };
  }
  
  // Parse full address: "123 Street\nCity,State,Country"
  const lines = address.split('\n');
  if (lines.length > 1) {
    const cityStateLine = lines[1].trim();
    const parts = cityStateLine.split(',').map(s => s.trim());
    return { 
      city: parts[0], 
      state: parts[1] || 'US'
    };
  }
  
  // Fallback: assume it's just the city
  return { city: address.trim(), state: 'US' };
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
  
  if (cityOrAddress && cityOrAddress.includes('\n')) {
    const parsed = parseCityState(cityOrAddress);
    city = parsed.city;
    stateCode = parsed.state;
  }

  if (!city) {
    console.warn('No city provided for weather lookup');
    return null;
  }

  const cacheKey = `${city},${stateCode}`.toLowerCase();
  const cached = weatherCache.get(cacheKey);
  
  // Return cached data if still fresh
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }

  try {
    const query = `${city},${stateCode},US`;
    const url = `${BASE_URL}/weather?q=${encodeURIComponent(query)}&appid=${OPENWEATHER_API_KEY}&units=imperial`;
    
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
    console.error('Failed to fetch weather:', error);
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