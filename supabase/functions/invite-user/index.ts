import { getClients, assertAdmin } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const auth = await assertAdmin(req);
  if (auth instanceof Response) return auth;

  try {
    const { email, role = "dispatcher", is_admin = false, redirectTo } = await req.json();
    if (!email) return new Response("Email required", { status: 400 });

    const { admin } = getClients();
    const { data: inviteData, error: inviteErr } =
      await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (inviteErr) throw inviteErr;

    const user = inviteData.user;
    if (!user) throw new Error("Invite failed: no user returned");

    const { error: upErr } = await admin.from("users").upsert({
      id: user.id,
      email: user.email,
      role,
      is_admin,
      status: "INVITED",
      last_sign_in_at: user.last_sign_in_at,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (upErr) throw upErr;

    return Response.json({ ok: true, id: user.id });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 500 });
  }
});
