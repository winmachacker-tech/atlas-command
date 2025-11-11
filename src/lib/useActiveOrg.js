// src/lib/useActiveOrg.js
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * Get the current user's active organization.
 * Returns: { orgId, orgName, role, loading, error, refresh }
 */
export function useActiveOrg() {
  const [orgId, setOrgId] = useState(null);
  const [orgName, setOrgName] = useState("");
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      // 1) Who am I?
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!user) {
        setError("No user session");
        setLoading(false);
        return;
      }

      // 2) Find org mapping + name
      const { data, error: qErr } = await supabase
        .from("user_orgs")
        .select("org_id, role, organizations!inner(name)")
        .eq("user_id", user.id)
        .limit(1)
        .single();

      if (qErr) throw qErr;

      setOrgId(data?.org_id || null);
      setOrgName(data?.organizations?.name || "");
      setRole(data?.role || null);
    } catch (e) {
      setError(e.message || "Failed to load active org");
      setOrgId(null);
      setOrgName("");
      setRole(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // also react to auth changes
    const { data: sub } = supabase.auth.onAuthStateChange(() => load());
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  return { orgId, orgName, role, loading, error, refresh: load };
}

