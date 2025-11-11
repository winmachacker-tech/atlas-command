// src/lib/driverFit.js

/**
 * Driver Fit Score (pure frontend utility)
 * ----------------------------------------
 * Scores how well a load matches a driver's preferences.
 *
 * Inputs:
 *  - driverProfile (from driver_preference_profile RPC or DriverPreferences component):
 *      {
 *        driver_id: string,
 *        home_base: string | null,               // e.g., "Sacramento, CA"
 *        preferred_regions: string[],            // e.g., ["West Coast", "Midwest"]
 *        preferred_equipment: string[],          // e.g., ["Dry Van", "Reefer"]
 *        avoid_states: string[],                 // e.g., ["NY","NJ"]
 *        max_distance: number | null,            // miles (one-way target comfort)
 *        notes: string | null,
 *        updated_at: string | null
 *      }
 *
 *  - load (minimal fields; adapt to your schema as needed):
 *      {
 *        origin_city?: string,
 *        origin_state?: string,     // "CA"
 *        dest_city?: string,
 *        dest_state?: string,       // "WA"
 *        equipment_type?: string,   // "Dry Van"
 *        miles?: number,            // total trip miles (planned)
 *
 *        // optional if you have coords for better geographic scoring:
 *        origin_lat?: number,
 *        origin_lng?: number,
 *        dest_lat?: number,
 *        dest_lng?: number,
 *
 *        // optional metadata your UI/agents might have:
 *        lane_name?: string,        // "SAC, CA â†’ SEA, WA"
 *        pickup_date?: string
 *      }
 *
 * Output:
 *  {
 *    score: number,            // 0..100 (clamped)
 *    verdict: "excellent"|"good"|"ok"|"poor",
 *    reasons: string[],        // human summary
 *    breakdown: {              // detailed points by category
 *      equipment: number,      // 0..30
 *      region: number,         // 0..30
 *      distance: number,       // 0..25
 *      compliance: number,     // 0..15  (penalties for avoid_states, etc.)
 *    },
 *    meta: {
 *      matched_equipment: string | null,
 *      matched_region_tags: string[],
 *      hits: Record<string, any>
 *    }
 *  }
 */

/* ------------------------------- helpers ------------------------------- */

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function normStr(x) {
  return (x || "").toString().trim().toLowerCase();
}

function toArr(x) {
  return Array.isArray(x) ? x : x ? [x] : [];
}

/** Very light region tagging from state (fallback text heuristics). */
const STATE_TO_REGION = {
  // West
  AK: "West Coast", AZ: "West Coast", CA: "West Coast", CO: "West",
  HI: "West", ID: "West", MT: "West", NV: "West Coast", NM: "West",
  OR: "West Coast", UT: "West", WA: "West Coast", WY: "West",

  // Midwest
  IL: "Midwest", IN: "Midwest", IA: "Midwest", KS: "Midwest", MI: "Midwest",
  MN: "Midwest", MO: "Midwest", NE: "Midwest", ND: "Midwest", OH: "Midwest",
  SD: "Midwest", WI: "Midwest",

  // South
  AL: "South", AR: "South", DE: "South", FL: "South", GA: "South",
  KY: "South", LA: "South", MD: "South", MS: "South", NC: "South",
  OK: "South", SC: "South", TN: "South", TX: "South", VA: "South",
  WV: "South", DC: "South",

  // Northeast
  CT: "Northeast", ME: "Northeast", MA: "Northeast", NH: "Northeast",
  NJ: "Northeast", NY: "Northeast", PA: "Northeast", RI: "Northeast", VT: "Northeast",
};

/** Extract region tags for a load based on its origin/dest states. */
function deriveLoadRegions(load) {
  const tags = new Set();
  const o = (load.origin_state || "").toUpperCase();
  const d = (load.dest_state || "").toUpperCase();
  if (STATE_TO_REGION[o]) tags.add(STATE_TO_REGION[o]);
  if (STATE_TO_REGION[d]) tags.add(STATE_TO_REGION[d]);
  return Array.from(tags);
}

/** Try to detect short state like "CA" inside a string; returns array of "CA" hits. */
function extractStatesFromText(s) {
  if (!s) return [];
  const out = [];
  const re = /\b(A[LKZR]|C[AOT]|D[CE]|F[LM]|G[AU]|H[I]|I[ADLN]|K[SY]|L[A]|M[ADEHINOST]|N[CDEHJMVY]|O[HKR]|P[A]|R[I]|S[CD]|T[NX]|U[T]|V[AIT]|W[AIVY])\b/gi;
  let m;
  while ((m = re.exec(s))) out.push(m[1].toUpperCase());
  return out;
}

/** Simple fuzzy equipment match ("dry van" ~ "van"). */
function equipmentMatches(driverEquipmentList, loadEquip) {
  if (!loadEquip) return { hit: false, matched: null };
  const le = normStr(loadEquip);
  const aliases = [
    [/(dry\s*)?van/, ["van", "dry van", "dryvan"]],
    [/reefer|refrigerated/, ["reefer", "refrigerated"]],
    [/flat\s*bed|flatbed/, ["flat", "flatbed"]],
    [/step\s*deck|stepdeck/, ["step deck", "stepdeck", "step-deck"]],
    [/power\s*only|poweronly/, ["power only", "power-only"]],
  ];

  const driverNorms = new Set(driverEquipmentList.map(normStr));

  // exact-ish
  for (const s of driverNorms) {
    if (le.includes(s)) return { hit: true, matched: s };
  }

  // alias patterns
  for (const [rx, keys] of aliases) {
    if (rx.test(le)) {
      for (const k of keys) {
        if (driverNorms.has(k)) return { hit: true, matched: k };
      }
    }
  }

  // last resort: substring contains any driver equip token
  for (const s of driverNorms) {
    if (s && le.includes(s)) return { hit: true, matched: s };
  }
  return { hit: false, matched: null };
}

/**
 * Estimate origin "distance pressure":
 * - If driver has max_distance (comfort range), then:
 *    * distanceScore is proportional up to that value, with soft tolerance (+200 mi)
 * - If no miles provided, we skip distance scoring.
 * - If home_base present and matches origin_state, small bonus.
 */
function scoreDistance(miles, driverMax, originState, homeBaseText) {
  const MAX_POINTS = 25;
  if (!miles || miles <= 0) {
    return { points: 0, reasons: ["Distance: unknown miles (no score)"] };
  }

  let points = 0;
  const reasons = [];

  if (driverMax && driverMax > 0) {
    const softCap = driverMax + 200; // tolerance
    if (miles <= driverMax) {
      // perfect fit within comfort
      points = MAX_POINTS;
      reasons.push(`Distance within preferred max (${miles} â‰¤ ${driverMax})`);
    } else if (miles <= softCap) {
      // degrade linearly in the tolerance band
      const frac = 1 - (miles - driverMax) / (softCap - driverMax);
      points = Math.round(MAX_POINTS * frac * 0.7); // soften a bit
      reasons.push(`Distance slightly above preferred (${miles} > ${driverMax})`);
    } else {
      points = Math.round(MAX_POINTS * 0.15); // far outside preference
      reasons.push(`Distance exceeds comfort (${miles} Â» ${driverMax})`);
    }
  } else {
    // No preference given â†’ neutral based on miles length (favor shorter)
    if (miles <= 400) {
      points = Math.round(MAX_POINTS * 0.9);
      reasons.push("No max distance set; short trip favored");
    } else if (miles <= 900) {
      points = Math.round(MAX_POINTS * 0.6);
      reasons.push("No max distance set; medium trip");
    } else {
      points = Math.round(MAX_POINTS * 0.3);
      reasons.push("No max distance set; long trip");
    }
  }

  // Soft proximity bonus if home_base mentions the same state as origin
  const hbStates = extractStatesFromText(homeBaseText || "");
  const oS = (originState || "").toUpperCase();
  if (hbStates.includes(oS)) {
    points = clamp(points + 3, 0, MAX_POINTS);
    reasons.push("Home base aligns with origin state");
  }

  return { points, reasons };
}

/** Map score to verdict */
function verdictFromScore(s) {
  if (s >= 85) return "excellent";
  if (s >= 70) return "good";
  if (s >= 55) return "ok";
  return "poor";
}

/* ------------------------------- main API ------------------------------- */

/**
 * Compute a 0..100 fit score with breakdown.
 */
export function computeDriverFit(driverProfile, load) {
  const reasons = [];
  const breakdown = {
    equipment: 0,
    region: 0,
    distance: 0,
    compliance: 15, // start full and subtract penalties
  };
  const meta = {
    matched_equipment: null,
    matched_region_tags: [],
    hits: {},
  };

  // Normalize driver inputs
  const prefRegions = (driverProfile?.preferred_regions || []).map((s) => s?.trim()).filter(Boolean);
  const prefEquip = (driverProfile?.preferred_equipment || []).map((s) => s?.trim()).filter(Boolean);
  const avoidStates = (driverProfile?.avoid_states || []).map((s) => s?.toUpperCase()).filter(Boolean);
  const maxDistance = driverProfile?.max_distance || null;
  const homeBase = driverProfile?.home_base || null;

  const originState = (load?.origin_state || "").toUpperCase();
  const destState = (load?.dest_state || "").toUpperCase();
  const miles = load?.miles ?? null;

  /* --- Compliance penalties (avoid states) --- */
  let avoidPenalty = 0;
  if (originState && avoidStates.includes(originState)) {
    avoidPenalty += 10;
    reasons.push(`Origin in avoid state: ${originState}`);
  }
  if (destState && avoidStates.includes(destState)) {
    avoidPenalty += 10;
    reasons.push(`Destination in avoid state: ${destState}`);
  }
  breakdown.compliance = clamp(breakdown.compliance - avoidPenalty, 0, 15);
  meta.hits.avoid_penalty = avoidPenalty;

  /* --- Equipment (0..30) --- */
  // If driver has preferences, require a match to award high points; otherwise give neutral mid.
  const eq = equipmentMatches(prefEquip, load?.equipment_type);
  if (prefEquip.length > 0) {
    if (eq.hit) {
      breakdown.equipment = 28;
      meta.matched_equipment = eq.matched;
      reasons.push(`Equipment match: ${load?.equipment_type} âœ“`);
    } else {
      breakdown.equipment = 8; // mismatch but not zero (still might run)
      reasons.push(`Equipment mismatch (pref: ${prefEquip.join(", ") || "â€”"})`);
    }
  } else {
    breakdown.equipment = 18; // neutral if driver gave no equipment prefs
    if (load?.equipment_type) reasons.push(`No equipment prefs; load is ${load.equipment_type}`);
  }

  /* --- Region (0..30) --- */
  // Tag load's regions from states; then intersect with preferred_regions
  const loadRegions = deriveLoadRegions(load);
  meta.matched_region_tags = loadRegions;

  if (prefRegions.length > 0) {
    const drSet = new Set(prefRegions.map(normStr));
    const hits = loadRegions.filter((r) => drSet.has(normStr(r)));
    if (hits.length > 0) {
      breakdown.region = 26;
      reasons.push(`Region match: ${hits.join(", ")} âœ“`);
    } else {
      // still partial credit if driver has no explicit conflict
      breakdown.region = 10;
      reasons.push(`Outside listed regions (load: ${loadRegions.join(", ") || "unknown"})`);
    }
  } else {
    // No region prefs â†’ neutral mid-high
    breakdown.region = 18;
    reasons.push("No region prefs set");
  }

  /* --- Distance (0..25) --- */
  const dist = scoreDistance(miles, maxDistance, originState, homeBase);
  breakdown.distance = dist.points;
  reasons.push(...dist.reasons);

  /* --- Sum + clamp --- */
  let score = breakdown.equipment + breakdown.region + breakdown.distance + breakdown.compliance;
  score = clamp(Math.round(score), 0, 100);

  return {
    score,
    verdict: verdictFromScore(score),
    reasons,
    breakdown,
    meta,
  };
}

/* ------------------------------- convenience ------------------------------- */

/**
 * Shorthand that accepts the raw RPC result shape (jsonb) directly:
 *   const rpc = await supabase.rpc('driver_preference_profile', { p_driver_id: id });
 *   const result = fitLoadForDriver(rpc.data, load);
 */
export function fitLoadForDriver(driverPreferenceProfileJson, load) {
  // Defensive: if your RPC returns {error:'access_denied'} or null
  if (!driverPreferenceProfileJson || driverPreferenceProfileJson.error) {
    return {
      score: 0,
      verdict: "poor",
      reasons: ["No access to driver preferences or preferences missing"],
      breakdown: { equipment: 0, region: 0, distance: 0, compliance: 0 },
      meta: { matched_equipment: null, matched_region_tags: [], hits: {} },
    };
  }
  return computeDriverFit(driverPreferenceProfileJson, load);
}

/* ------------------------------- example usage -------------------------------
import { fitLoadForDriver } from '../lib/driverFit';

const { data: profile } = await supabase.rpc('driver_preference_profile', { p_driver_id: driverId });
const load = {
  origin_city: 'Sacramento',
  origin_state: 'CA',
  dest_city: 'Seattle',
  dest_state: 'WA',
  equipment_type: 'Dry Van',
  miles: 650
};
const fit = fitLoadForDriver(profile, load);
// fit.score, fit.verdict, fit.breakdown, fit.reasons
------------------------------------------------------------------------------- */

