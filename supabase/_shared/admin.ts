// supabase/functions/_shared/admin.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function getClients() {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Admin client (service role)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Public client (to check caller’s auth & is_admin via RLS)
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

  return { admin, anon };
}

export async function assertAdmin(request: Request) {
  const { anon } = getClients();
  const authHeader = request.headers.get("Authorization") || "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  if (!jwt) return new Response("Unauthorized", { status: 401 });

  // 1) Who is calling?
  const { data: userData, error: userErr } = await anon.auth.getUser(jwt);
  if (userErr || !userData.user) return new Response("Unauthorized", { status: 401 });

  const uid = userData.user.id;

  // 2) Check admin via RLS
  const { data, error } = await anon
    .from("users")
    .select("is_admin")
    .eq("id", uid)
    .single();

  if (error || !data?.is_admin) return new Response("Forbidden", { status: 403 });

  return { uid };
}
