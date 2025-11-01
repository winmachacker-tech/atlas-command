import { getClients, assertAdmin } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const auth = await assertAdmin(req);
  if (auth instanceof Response) return auth;

  try {
    const { id } = await req.json();
    if (!id) return new Response("id required", { status: 400 });

    const { admin } = getClients();

    const { error: delAuthErr } = await admin.auth.admin.deleteUser(id);
    if (delAuthErr) throw delAuthErr;

    const { error: delMetaErr } = await admin.from("users").delete().eq("id", id);
    if (delMetaErr) throw delMetaErr;

    return Response.json({ ok: true });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 500 });
  }
});
