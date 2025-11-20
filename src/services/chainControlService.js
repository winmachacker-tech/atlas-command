// src/services/chainControlService.js
import { getWeatherByCoordinates } from './weatherService';

/**
 * Major mountain passes in the US that require chain control monitoring
 * Data includes location, states, highways, and elevation
 */
const MOUNTAIN_PASSES = [
  // California
  {
    id: 'donner-pass',
    name: 'Donner Pass',
    highway: 'I-80',
    state: 'CA',
    lat: 39.3158,
    lng: -120.3244,
    elevation: 7135,
    description: 'I-80 between Reno and Sacramento'
  },
  {
    id: 'grapevine',
    name: 'The Grapevine (Tejon Pass)',
    highway: 'I-5',
    state: 'CA',
    lat: 34.9370,
    lng: -118.8811,
    elevation: 4144,
    description: 'I-5 between LA and Bakersfield'
  },
  {
    id: 'siskiyou-summit',
    name: 'Siskiyou Summit',
    highway: 'I-5',
    state: 'CA/OR',
    lat: 42.0689,
    lng: -122.6158,
    elevation: 4310,
    description: 'I-5 California-Oregon border'
  },
  {
    id: 'tehachapi-pass',
    name: 'Tehachapi Pass',
    highway: 'CA-58',
    state: 'CA',
    lat: 35.1358,
    lng: -118.5572,
    elevation: 3793,
    description: 'CA-58 east of Bakersfield'
  },
  
  // Oregon
  {
    id: 'cabbage-hill',
    name: 'Cabbage Hill',
    highway: 'I-84',
    state: 'OR',
    lat: 45.5650,
    lng: -118.3500,
    elevation: 3625,
    description: 'I-84 near Pendleton'
  },
  {
    id: 'santiam-pass',
    name: 'Santiam Pass',
    highway: 'US-20',
    state: 'OR',
    lat: 44.4167,
    lng: -121.8667,
    elevation: 4817,
    description: 'US-20 over Cascade Range'
  },
  
  // Washington
  {
    id: 'snoqualmie-pass',
    name: 'Snoqualmie Pass',
    highway: 'I-90',
    state: 'WA',
    lat: 47.4244,
    lng: -121.4175,
    elevation: 3022,
    description: 'I-90 over Cascade Range'
  },
  {
    id: 'stevens-pass',
    name: 'Stevens Pass',
    highway: 'US-2',
    state: 'WA',
    lat: 47.7453,
    lng: -121.0889,
    elevation: 4061,
    description: 'US-2 over Cascade Range'
  },
  {
    id: 'blewett-pass',
    name: 'Blewett Pass',
    highway: 'US-97',
    state: 'WA',
    lat: 47.3461,
    lng: -120.6156,
    elevation: 4102,
    description: 'US-97 north of Ellensburg'
  },
  
  // Colorado
  {
    id: 'vail-pass',
    name: 'Vail Pass',
    highway: 'I-70',
    state: 'CO',
    lat: 39.5333,
    lng: -106.2167,
    elevation: 10662,
    description: 'I-70 between Vail and Copper Mountain'
  },
  {
    id: 'eisenhower-tunnel',
    name: 'Eisenhower Tunnel',
    highway: 'I-70',
    state: 'CO',
    lat: 39.6786,
    lng: -105.9194,
    elevation: 11158,
    description: 'I-70 west of Denver'
  },
  {
    id: 'monarch-pass',
    name: 'Monarch Pass',
    highway: 'US-50',
    state: 'CO',
    lat: 38.4978,
    lng: -106.3311,
    elevation: 11312,
    description: 'US-50 Continental Divide'
  },
  {
    id: 'wolf-creek-pass',
    name: 'Wolf Creek Pass',
    highway: 'US-160',
    state: 'CO',
    lat: 37.4761,
    lng: -106.7928,
    elevation: 10857,
    description: 'US-160 Continental Divide'
  },
  
  // Wyoming
  {
    id: 'teton-pass',
    name: 'Teton Pass',
    highway: 'WY-22',
    state: 'WY',
    lat: 43.4903,
    lng: -110.9561,
    elevation: 8431,
    description: 'WY-22 between Jackson and Victor'
  },
  
  // Montana
  {
    id: 'lookout-pass',
    name: 'Lookout Pass',
    highway: 'I-90',
    state: 'MT/ID',
    lat: 47.4644,
    lng: -115.6767,
    elevation: 4710,
    description: 'I-90 Montana-Idaho border'
  },
  {
    id: 'homestake-pass',
    name: 'Homestake Pass',
    highway: 'I-90',
    state: 'MT',
    lat: 45.8811,
    lng: -112.4367,
    elevation: 6329,
    description: 'I-90 west of Butte'
  },
  
  // Nevada
  {
    id: 'galena-summit',
    name: 'Galena Summit',
    highway: 'NV-341',
    state: 'NV',
    lat: 39.3097,
    lng: -119.7644,
    elevation: 7334,
    description: 'NV-341 near Reno'
  },
  
  // Utah
  {
    id: 'parley-summit',
    name: "Parley's Summit",
    highway: 'I-80',
    state: 'UT',
    lat: 40.7672,
    lng: -111.6158,
    elevation: 7120,
    description: 'I-80 east of Salt Lake City'
  },
  {
    id: 'soldier-summit',
    name: 'Soldier Summit',
    highway: 'US-6',
    state: 'UT',
    lat: 39.9353,
    lng: -111.0603,
    elevation: 7477,
    description: 'US-6 southeast of Provo'
  }
];

/**
 * Chain control requirement levels
 */
export const CHAIN_LEVELS = {
  NONE: {
    level: 0,
    code: 'NONE',
    label: 'No Chain Requirement',
    description: 'Roads are clear, no chains required',
    color: 'emerald'
  },
  R1: {
    level: 1,
    code: 'R1',
    label: 'Chains Required (R-1)',
    description: 'Chains or approved traction devices required on drive axle',
    color: 'yellow'
  },
  R2: {
    level: 2,
    code: 'R2',
    label: 'Chains Required All Vehicles (R-2)',
    description: 'Chains required on all vehicles except 4WD/AWD with snow tires',
    color: 'amber'
  },
  R3: {
    level: 3,
    code: 'R3',
    label: 'Road Closed (R-3)',
    description: 'Pass closed to all traffic - DO NOT ATTEMPT',
    color: 'red'
  }
};

/**
 * Calculate distance between two coordinates using Haversine formula
 */
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Find mountain passes near the route
 * @param {Array} waypoints - Route waypoints with {lat, lng}
 * @param {number} maxDistance - Maximum distance in miles to consider (default 25)
 * @returns {Array} Array of nearby passes
 */
export function findPassesNearRoute(waypoints, maxDistance = 25) {
  if (!waypoints || waypoints.length < 2) return [];
  
  const nearbyPasses = [];
  
  for (const pass of MOUNTAIN_PASSES) {
    // Check if pass is near any point on the route
    for (const waypoint of waypoints) {
      const distance = getDistance(
        waypoint.lat,
        waypoint.lng,
        pass.lat,
        pass.lng
      );
      
      if (distance <= maxDistance) {
        nearbyPasses.push({
          ...pass,
          distanceFromRoute: distance
        });
        break; // Only add pass once
      }
    }
  }
  
  // Sort by distance from route
  return nearbyPasses.sort((a, b) => a.distanceFromRoute - b.distanceFromRoute);
}

/**
 * Determine chain requirement level based on weather conditions
 * @param {Object} weather - Weather data from OpenWeatherMap
 * @param {number} elevation - Elevation in feet
 * @returns {Object} Chain requirement level
 */
export function determineChainRequirement(weather, elevation) {
  if (!weather) return CHAIN_LEVELS.NONE;
  
  const condition = weather.condition;
  const description = (weather.description || '').toLowerCase();
  const temp = weather.temp;
  const windSpeed = weather.windSpeed;
  
  // R-3: Road closure conditions
  // Blizzard, heavy snow with low visibility, or extreme conditions
  if (
    description.includes('blizzard') ||
    (condition === 'Snow' && description.includes('heavy') && windSpeed > 40) ||
    (condition === 'Thunderstorm' && elevation > 5000) ||
    condition === 'Tornado' ||
    condition === 'Hurricane'
  ) {
    return CHAIN_LEVELS.R3;
  }
  
  // R-2: Chains required all vehicles
  // Heavy snow, moderate snow with wind, or icy conditions
  if (
    (condition === 'Snow' && description.includes('heavy')) ||
    (condition === 'Snow' && description.includes('moderate') && windSpeed > 25) ||
    (condition === 'Snow' && temp <= 20) || // Very cold with any snow
    (description.includes('ice') || description.includes('freezing'))
  ) {
    return CHAIN_LEVELS.R2;
  }
  
  // R-1: Chains required on drive axle
  // Light to moderate snow, or freezing conditions
  if (
    (condition === 'Snow' && temp <= 32) ||
    (condition === 'Rain' && temp <= 34) || // Freezing rain
    (description.includes('sleet'))
  ) {
    return CHAIN_LEVELS.R1;
  }
  
  return CHAIN_LEVELS.NONE;
}

/**
 * Check chain control requirements for passes along the route
 * @param {Array} waypoints - Route waypoints with {lat, lng}
 * @returns {Promise<Array>} Array of chain control alerts
 */
export async function getChainControlAlerts(waypoints) {
  if (!waypoints || waypoints.length < 2) {
    console.log('[ChainControl] Not enough waypoints');
    return [];
  }
  
  const alerts = [];
  
  // Find passes near the route
  const nearbyPasses = findPassesNearRoute(waypoints, 25);
  
  console.log(`[ChainControl] Found ${nearbyPasses.length} passes near route`);
  
  // Check weather conditions at each pass
  for (const pass of nearbyPasses) {
    try {
      const weather = await getWeatherByCoordinates(pass.lat, pass.lng);
      
      if (!weather) continue;
      
      const chainRequirement = determineChainRequirement(weather, pass.elevation);
      
      // Only create alert if chains are required or road is closed
      if (chainRequirement.level > 0) {
        alerts.push({
          passId: pass.id,
          passName: pass.name,
          highway: pass.highway,
          state: pass.state,
          elevation: pass.elevation,
          description: pass.description,
          distanceFromRoute: pass.distanceFromRoute,
          chainRequirement,
          weather: {
            condition: weather.condition,
            description: weather.description,
            temp: weather.temp,
            windSpeed: weather.windSpeed
          },
          location: {
            lat: pass.lat,
            lng: pass.lng
          }
        });
        
        console.log(
          `[ChainControl] ${chainRequirement.code} at ${pass.name}: ${weather.description}, ${weather.temp}°F`
        );
      }
    } catch (error) {
      console.warn(`[ChainControl] Failed to check ${pass.name}:`, error);
    }
  }
  
  // Sort by severity (R-3 first) then by distance
  return alerts.sort((a, b) => {
    if (a.chainRequirement.level !== b.chainRequirement.level) {
      return b.chainRequirement.level - a.chainRequirement.level;
    }
    return a.distanceFromRoute - b.distanceFromRoute;
  });
}

/**
 * Get chain control emoji based on requirement level
 */
export function getChainControlEmoji(chainLevel) {
  switch (chainLevel.code) {
    case 'R3':
      return '🚫';
    case 'R2':
      return '⛓️';
    case 'R1':
      return '🔗';
    default:
      return '✅';
  }
}

/**
 * Get detailed chain control advice for drivers
 */
export function getChainControlAdvice(chainRequirement) {
  switch (chainRequirement.code) {
    case 'R3':
      return 'DO NOT ATTEMPT - Road is closed to all traffic. Find an alternate route or wait for conditions to improve.';
    case 'R2':
      return 'Chains required on ALL VEHICLES. Install chains on all drive wheels before attempting passage. Allow extra time and drive slowly.';
    case 'R1':
      return 'Chains required on drive axle. Commercial vehicles must have chains installed on at least one drive axle. Carry chains and be prepared to install if conditions worsen.';
    default:
      return 'No chains currently required, but carry chains and monitor conditions.';
  }
}