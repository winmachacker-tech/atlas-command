import { getClients, assertAdmin } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const auth = await assertAdmin(req);
  if (auth instanceof Response) return auth;

  try {
    const { email, redirectTo } = await req.json();
    if (!email) return new Response("Email required", { status: 400 });

    const { admin } = getClients();
    const { data, error } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { redirectTo },
    });
    if (error) throw error;

    return Response.json({ ok: true, link: data.properties?.action_link });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 500 });
  }
});
