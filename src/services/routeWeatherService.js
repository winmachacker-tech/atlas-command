// src/services/routeWeatherService.js

/**
 * Get weather alerts along a route
 * @param {Array} waypoints - Array of {lat, lng, name} coordinates
 * @returns {Promise<Array>} Weather alerts with locations
 */
export async function getRouteWeatherAlerts(waypoints) {
  if (!waypoints || waypoints.length < 2) return [];
  
  const alerts = [];
  
  // Sample points: start, end, and points every 100 miles
  const samplePoints = getSamplePoints(waypoints);
  
  for (const point of samplePoints) {
    try {
      const weather = await getWeatherByCoordinates(point.lat, point.lng);
      
      if (isSevereWeather(weather)) {
        alerts.push({
          location: point.name || `${point.lat.toFixed(2)}, ${point.lng.toFixed(2)}`,
          severity: getSeverityLevel(weather),
          condition: weather.condition,
          description: weather.description,
          windSpeed: weather.windSpeed,
          temp: weather.temp,
          icon: getWeatherEmoji(weather.condition),
        });
      }
    } catch (error) {
      console.warn(`Failed to fetch weather for ${point.name}:`, error);
    }
  }
  
  return alerts;
}

/**
 * Get sample points along route for weather checking
 */
function getSamplePoints(waypoints) {
  // Start with pickup and delivery
  const samples = [
    { ...waypoints[0], name: 'Pickup' },
    { ...waypoints[waypoints.length - 1], name: 'Delivery' }
  ];
  
  // Add midpoint if route is long enough
  if (waypoints.length > 2) {
    const midIndex = Math.floor(waypoints.length / 2);
    samples.splice(1, 0, { ...waypoints[midIndex], name: 'Midpoint' });
  }
  
  return samples;
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
  if (weather.windSpeed > 35 || ['Rain', 'Fog'].includes(weather.condition)) {
    return 'moderate';
  }
  
  return 'info';
}