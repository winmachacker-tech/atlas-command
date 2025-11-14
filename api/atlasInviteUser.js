// FILE: api/atlasInviteUser.js
// Serverless function on Vercel to send Supabase Auth invite emails.

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.warn(
    "[atlasInviteUser] Missing VITE_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL env var."
  );
}
if (!SERVICE_ROLE_KEY) {
  console.warn(
    "[atlasInviteUser] Missing SUPABASE_SERVICE_ROLE_KEY env var. Invite will fail."
  );
}

const supabaseAdmin =
  SUPABASE_URL && SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })
    : null;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({
      error:
        "Supabase admin client is not configured. Check SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_URL.",
    });
  }

  try {
    const { email } = req.body || {};

    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email is required." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    console.log("[atlasInviteUser] Inviting:", normalizedEmail);

    const { data, error } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail);

    if (error) {
      console.error("[atlasInviteUser] Supabase invite error:", error);
      return res.status(400).json({ error: error.message || "Invite failed." });
    }

    const user = data?.user || null;
    console.log("[atlasInviteUser] Invite result user:", user?.id || null);

    return res.status(200).json({
      success: true,
      email: normalizedEmail,
      userId: user?.id || null,
      createdAt: user?.created_at || null,
      message:
        "Invite email sent. User row should now appear in Supabase Auth → Users.",
    });
  } catch (e) {
    console.error("[atlasInviteUser] Unexpected error:", e);
    return res.status(500).json({ error: "Internal server error." });
  }
};
