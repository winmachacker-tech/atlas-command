import { getClients, assertAdmin } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const auth = await assertAdmin(req);
  if (auth instanceof Response) return auth;

  try {
    const { id, role, is_admin, status, full_name } = await req.json();
    if (!id) return new Response("id required", { status: 400 });

    const { admin } = getClients();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (role) patch.role = role;
    if (typeof is_admin === "boolean") patch.is_admin = is_admin;
    if (status) patch.status = status;
    if (typeof full_name === "string") patch.full_name = full_name;

    const { error } = await admin.from("users").update(patch).eq("id", id);
    if (error) throw error;

    return Response.json({ ok: true });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 500 });
  }
});
