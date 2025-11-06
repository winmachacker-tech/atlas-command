// src/lib/activityTracker.js
import { supabase } from "./supabase";

/**
 * Get basic device info from user agent
 */
function getDeviceInfo(userAgent) {
  const ua = userAgent.toLowerCase();
  
  // Detect OS
  let os = "Unknown";
  if (ua.includes("windows")) os = "Windows";
  else if (ua.includes("mac os x")) os = "macOS";
  else if (ua.includes("linux")) os = "Linux";
  else if (ua.includes("android")) os = "Android";
  else if (ua.includes("iphone") || ua.includes("ipad")) os = "iOS";
  
  // Detect Browser
  let browser = "Unknown";
  if (ua.includes("edg")) browser = "Edge";
  else if (ua.includes("chrome")) browser = "Chrome";
  else if (ua.includes("safari") && !ua.includes("chrome")) browser = "Safari";
  else if (ua.includes("firefox")) browser = "Firefox";
  
  return `${browser} on ${os}`;
}

/**
 * Get approximate location from IP (using a free IP geolocation service)
 * This is optional - returns null if it fails
 */
async function getLocationFromIP(ip) {
  try {
    // Using ipapi.co free tier (1000 requests/day)
    const response = await fetch(`https://ipapi.co/${ip}/json/`);
    if (!response.ok) return null;
    
    const data = await response.json();
    if (data.city && data.region) {
      return `${data.city}, ${data.region}`;
    }
    return null;
  } catch (e) {
    console.warn("Failed to get location:", e);
    return null;
  }
}

/**
 * Get client IP address
 * Note: In production, you'd get this from your server
 * For now, we'll just use a placeholder
 */
async function getClientIP() {
  try {
    // Using ipify for getting public IP (free service)
    const response = await fetch("https://api.ipify.org?format=json");
    const data = await response.json();
    return data.ip || "Unknown";
  } catch (e) {
    console.warn("Failed to get IP:", e);
    return "Unknown";
  }
}

/**
 * Track user activity (login, logout, etc.)
 * 
 * @param {string} activityType - Type of activity (e.g., 'login', 'logout')
 * @param {boolean} success - Whether the activity was successful
 * @param {string} errorMessage - Error message if activity failed
 */
export async function trackActivity(activityType, success = true, errorMessage = null) {
  try {
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.warn("No user found for activity tracking");
      return;
    }

    // Get device/browser info
    const userAgent = navigator.userAgent;
    const deviceInfo = getDeviceInfo(userAgent);

    // Get IP address (optional - can be slow)
    let ipAddress = "Unknown";
    let location = null;
    
    try {
      ipAddress = await getClientIP();
      if (ipAddress && ipAddress !== "Unknown") {
        location = await getLocationFromIP(ipAddress);
      }
    } catch (e) {
      console.warn("Failed to get IP/location:", e);
    }

    // Insert activity record
    const { error: insertError } = await supabase
      .from("user_activity")
      .insert({
        user_id: user.id,
        activity_type: activityType,
        ip_address: ipAddress,
        user_agent: userAgent,
        device_info: deviceInfo,
        location: location,
        success: success,
        error_message: errorMessage,
      });

    if (insertError) {
      console.error("Failed to track activity:", insertError);
    } else {
      console.log(`Activity tracked: ${activityType}`);
    }
  } catch (e) {
    console.error("Error in trackActivity:", e);
  }
}

/**
 * Track login specifically
 */
export async function trackLogin() {
  return trackActivity("login", true);
}

/**
 * Track logout specifically
 */
export async function trackLogout() {
  return trackActivity("logout", true);
}

/**
 * Track failed login
 */
export async function trackFailedLogin(errorMessage) {
  return trackActivity("login", false, errorMessage);
}