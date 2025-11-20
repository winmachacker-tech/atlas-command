// src/lib/deviceFingerprint.js
// Mirror the Edge Function fingerprint:
// SHA-256 of `${user_agent}||${acceptLanguage}`

async function hashToHex(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compute the current browser's device fingerprint
 * in the same way as the Edge Function.
 */
export async function getCurrentDeviceFingerprint() {
  if (typeof window === "undefined") return null;

  const userAgent = navigator.userAgent || "unknown";
  const lang =
    navigator.language ||
    (Array.isArray(navigator.languages) ? navigator.languages[0] : "") ||
    "";

  const input = `${userAgent}||${lang}`;
  return await hashToHex(input);
}

/**
 * Human-readable label for the device.
 * For now we just echo the userAgent; you can
 * later parse into "Chrome on Windows", etc.
 */
export function getCurrentDeviceLabel() {
  if (typeof window === "undefined") return "Unknown device";
  return navigator.userAgent || "Unknown device";
}
