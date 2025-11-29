// FILE: src/lib/features.js
// Purpose:
// - Simple client-side feature flag reader for Atlas Command
// - Reads org_features scoped by current user's org_id
// - Exposes helper functions + React hook
//
// Depends on: supabase client from ./supabase

import { supabase } from "./supabase";
import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Cache (in-memory per session)
// ---------------------------------------------------------------------------
let featureCache = null;
let cacheLoaded = false;

// ---------------------------------------------------------------------------
// Load all org_features for the active org
// ---------------------------------------------------------------------------
export async function loadOrgFeatures() {
  if (cacheLoaded && featureCache) {
    return featureCache;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const orgId = user?.user_metadata?.org_id;
  if (!orgId) {
    console.warn("[features] No active org ID found.");
    featureCache = {};
    cacheLoaded = true;
    return featureCache;
  }

  const { data, error } = await supabase
    .from("org_features")
    .select("feature_key, is_enabled")
    .eq("org_id", orgId);

  if (error) {
    console.error("[features] Failed to load org_features:", error);
    featureCache = {};
    cacheLoaded = true;
    return featureCache;
  }

  const map = {};
  for (const row of data) {
    map[row.feature_key] = row.is_enabled === true;
  }

  featureCache = map;
  cacheLoaded = true;
  return featureCache;
}

// ---------------------------------------------------------------------------
// Check a feature synchronously (after load)
// ---------------------------------------------------------------------------
export function hasFeature(featureKey) {
  if (!cacheLoaded || !featureCache) {
    console.warn("[features] cache not loaded before hasFeature() call");
    return false;
  }
  return !!featureCache[featureKey];
}

// ---------------------------------------------------------------------------
// React hook: useFeature("ai.dipsy_voice_outbound")
// ---------------------------------------------------------------------------
export function useFeature(featureKey) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    async function get() {
      const features = await loadOrgFeatures();
      setEnabled(!!features[featureKey]);
    }
    get();
  }, [featureKey]);

  return enabled;
}

// ---------------------------------------------------------------------------
// requireFeature — useful for components that MUST have a feature
// (e.g. guard routes, show fallback, or throw)
// ---------------------------------------------------------------------------
export function requireFeature(featureKey) {
  if (!cacheLoaded) {
    console.warn("[features] requireFeature() called before cache loaded");
    return false;
  }
  return !!featureCache[featureKey];
}
