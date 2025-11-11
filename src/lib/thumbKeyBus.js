// One stable key per *user click* across the app for ~500ms.
// If multiple components try to log the *same* click, they’ll reuse the same key.

let lastKey = null;
let lastTs = 0;

export function getStableClickKey(rate) {
  const now = Date.now();
  if (!lastKey || (now - lastTs) > 500) {
    // new click window
    lastKey = `${now}-${Math.random().toString(36).slice(2,8)}-${rate}`;
  }
  lastTs = now;
  return lastKey;
}
