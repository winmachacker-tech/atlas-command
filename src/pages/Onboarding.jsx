// src/pages/Onboarding.jsx
// v4 – adds requireAuth() before save; fully null-safe everywhere.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, requireAuth } from "../lib/supabase";
import { Loader2, Upload, CheckCircle2, XCircle } from "lucide-react";

/* ------------------------------- safe utils ------------------------------- */
const S  = (v) => (v == null ? "" : String(v));       // null/undefined -> ""
const ST = (v) => S(v).replace(/^\s+|\s+$/g, "");     // safe "trim" without calling .trim()
const NZ = (v) => ST(v).length > 0;                   // non-empty after safe trim

export default function Onboarding() {
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [loadingUser, setLoadingUser] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // {ok:boolean, text:string}

  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    job_title: "",
    department: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    avatar_url: "",
  });

  /* ----------------------------- Auth check ----------------------------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingAuth(true);
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        const s = data?.session ?? null;
        if (!s?.user) {
          navigate("/login");
          return;
        }
        if (alive) setSession(s);
      } catch (e) {
        console.error(e);
        if (alive) navigate("/login");
      } finally {
        if (alive) setLoadingAuth(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [navigate]);

  /* ------------------------- Load existing profile ---------------------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!session?.user?.id) return;
      setLoadingUser(true);
      setMsg(null);
      try {
        const { data, error } = await supabase
          .from("users")
          .select("full_name, phone, job_title, department, timezone, avatar_url")
          .eq("id", session.user.id)
          .single();

        if (error && error.code !== "PGRST116") throw error; // not found is fine

        if (!alive) return;

        if (data) {
          setForm((f) => ({
            ...f,
            full_name: S(data.full_name),
            phone: S(data.phone),
            job_title: S(data.job_title),
            department: S(data.department),
            timezone: NZ(data.timezone) ? S(data.timezone) : f.timezone,
            avatar_url: S(data.avatar_url),
          }));
        }
      } catch (e) {
        console.error(e);
        if (alive) setMsg({ ok: false, text: e.message || "Failed to load profile." });
      } finally {
        if (alive) setLoadingUser(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [session?.user?.id]);

  /* ----------------------------- Handlers ------------------------------ */
  const handleChange = (e) => {
    const name = e?.target?.name;
    const value = e?.target?.value;
    if (!name) return;
    setForm((f) => ({ ...f, [name]: S(value) }));
  };

  const handleAvatarPick = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file || !session?.user?.id) return;

    setMsg(null);
    try {
      const name = S(file.name);
      const ext = name.includes(".") ? name.split(".").pop() : "png";
      const path = `avatars/${session.user.id}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("public")
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;

      const { data: pubUrl } = supabase.storage.from("public").getPublicUrl(path);
      setForm((f) => ({ ...f, avatar_url: S(pubUrl?.publicUrl) }));
      setMsg({ ok: true, text: "Avatar uploaded." });
    } catch (e2) {
      console.error(e2);
      setMsg({ ok: false, text: e2.message || "Avatar upload failed." });
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    setSaving(true);
    setMsg(null);

    try {
      // 🔐 Ensure a valid session/JWT before write (fixes 403 when anon)
      await requireAuth();

      // Re-check we have the user id
      const { data: s } = await supabase.auth.getSession();
      const uid = s?.session?.user?.id;
      if (!uid) throw new Error("Not authenticated. Please sign in again.");

      const payload = {
        id: uid,
        full_name: ST(form.full_name),
        phone: NZ(form.phone) ? ST(form.phone) : null,
        job_title: NZ(form.job_title) ? ST(form.job_title) : null,
        department: NZ(form.department) ? ST(form.department) : null,
        timezone: NZ(form.timezone) ? ST(form.timezone) : null,
        avatar_url: NZ(form.avatar_url) ? ST(form.avatar_url) : null,
        updated_at: new Date().toISOString(),
      };

      if (!NZ(payload.full_name)) {
        throw new Error("Please enter your full name.");
      }

      const { error } = await supabase.from("users").upsert(payload, {
        onConflict: "id",
        ignoreDuplicates: false,
      });
      if (error) throw error;

      setMsg({ ok: true, text: "Profile saved. You're all set!" });
      setTimeout(() => navigate("/"), 600);
    } catch (e3) {
      console.error(e3);
      setMsg({ ok: false, text: e3.message || "Could not save profile." });
    } finally {
      setSaving(false);
    }
  };

  const canSave = NZ(form.full_name);

  if (loadingAuth || loadingUser) {
    return (
      <div className="p-6 md:p-8">
        <div className="mx-auto max-w-xl rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center">
          <Loader2 className="size-6 animate-spin inline-block mr-2" />
          Loading…
        </div>
      </div>
    );
  }

  /* ------------------------------- Render ------------------------------- */
  return (
    <div className="p-6 md:p-8">
      <div className="mx-auto max-w-2xl rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
        <div className="px-6 py-5 border-b border-zinc-200 dark:border-zinc-800">
          <h1 className="text-lg font-semibold">Welcome! Let’s set up your profile</h1>
          <p className="text-sm text-zinc-500">Please complete a few details before getting started.</p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <div>
            <label className="block text-sm font-medium">Full Name *</label>
            <input
              name="full_name"
              required
              minLength={2}
              value={S(form.full_name)}
              onChange={handleChange}
              placeholder="Jane Doe"
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Phone</label>
            <input
              name="phone"
              value={S(form.phone)}
              onChange={handleChange}
              placeholder="+1 555 123 4567"
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium">Job Title</label>
              <input
                name="job_title"
                value={S(form.job_title)}
                onChange={handleChange}
                placeholder="Dispatcher, Ops Manager…"
                className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Department</label>
              <input
                name="department"
                value={S(form.department)}
                onChange={handleChange}
                placeholder="Operations, Sales…"
                className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium">Timezone</label>
            <input
              name="timezone"
              value={S(form.timezone)}
              onChange={handleChange}
              placeholder="America/Los_Angeles"
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Avatar</label>
            <div className="mt-1 flex items-center gap-3">
              <div className="size-12 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                {NZ(form.avatar_url) && (
                  <img src={S(form.avatar_url)} alt="avatar" className="w-full h-full object-cover" />
                )}
              </div>
              <label className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800">
                <Upload className="size-4" />
                <span>Upload</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleAvatarPick} />
              </label>
            </div>
          </div>

          {msg && (
            <div
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm border ${
                msg.ok
                  ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800"
                  : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200/60 dark:border-red-800"
              }`}
            >
              {msg.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
              <span>{S(msg.text)}</span>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={!canSave || saving}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700 disabled:opacity-60"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save & Continue
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
