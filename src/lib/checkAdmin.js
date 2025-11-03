// src/lib/checkAdmin.js
import { supabase } from "./supabase";

export async function checkAdmin() {
  const { data: s } = await supabase.auth.getSession();
  const session = s?.session;
  if (!session) return false;

  const { data, error } = await supabase
    .from("users")
    .select("is_admin, role")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error || !data) return false;
  if (data.is_admin === true) return true;
  if ((data.role || "").toLowerCase() === "admin") return true;
  return false;
}
