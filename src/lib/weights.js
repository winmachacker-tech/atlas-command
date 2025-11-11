// src/lib/weights.js
import { supabase } from "../lib/supabase";

/** Fetch current weights */
export async function getFitWeights() {
  const { data, error } = await supabase.from("v_fit_weights").select("*");
  if (error) throw error;
  return data; // [{name, value}]
}

/** Trigger the learner (calls Edge Function) */
export async function runLearner() {
  const url = `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || new URL(new URL(supabase.supabaseUrl).origin + '/functions/v1').toString()}/learn-fit-weights`;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`learn-fit-weights failed: ${t}`);
  }
  return res.json();
}

