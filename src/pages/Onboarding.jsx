import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

function phoneMask(v) {
  // lightweight masking: digits only -> (xxx) xxx-xxxx
  const d = (v || "").replace(/\D/g, "").slice(0, 10);
  const p1 = d.slice(0,3), p2 = d.slice(3,6), p3 = d.slice(6,10);
  if (d.length <= 3) return p1;
  if (d.length <= 6) return `(${p1}) ${p2}`;
  return `(${p1}) ${p2}-${p3}`;
}

export default function Onboarding() {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const location = useLocation();
  const backTo = location.state?.from?.pathname || "/";

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { nav("/login", { replace: true }); return; }

      const { data, error } = await supabase
        .from("users")
        .select("full_name, phone, employee_id")
        .eq("id", session.user.id)
        .single();

      if (!alive) return;
      if (error) {
        console.error("load profile error:", error);
        return;
      }
      setFullName(data?.full_name ?? "");
      setPhone(data?.phone ?? "");
      setEmployeeId(data?.employee_id ?? "");
    })();
    return () => { alive = false; };
  }, [nav]);

  async function onSave(e) {
    e.preventDefault();
    if (busy) return;

    const name = fullName.trim();
    const ph = phone.replace(/\D/g, "");
    const emp = employeeId.trim();

    if (!name) return alert("Please enter your full name.");
    if (ph.length < 10) return alert("Please enter a valid phone number.");
    if (!emp) return alert("Please enter your employee ID.");

    try {
      setBusy(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not logged in.");

      const { error } = await supabase
        .from("users")
        .update({ full_name: name, phone: ph, employee_id: emp })
        .eq("id", session.user.id);

      if (error) throw error;
      nav(backTo, { replace: true });
    } catch (err) {
      console.error("onboarding save failed:", err);
      alert(err.message || "Failed to save profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-xl rounded-2xl border p-6 shadow-sm bg-white/70 dark:bg-zinc-900/70">
        <h1 className="text-2xl font-semibold mb-1">Complete your profile</h1>
        <p className="text-sm text-zinc-500 mb-6">
          We’ll use this info for your Atlas Command account.
        </p>

        <form onSubmit={onSave} className="space-y-4">
          <div>
            <label className="text-sm block mb-1">Full name</label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Doe"
              required
            />
          </div>

          <div>
            <label className="text-sm block mb-1">Phone</label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={phoneMask(phone)}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              inputMode="tel"
              required
            />
            <p className="text-xs text-zinc-500 mt-1">
              Digits only are stored (e.g., 5551234567).
            </p>
          </div>

          <div>
            <label className="text-sm block mb-1">Employee ID</label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="E-1027"
              required
            />
          </div>

          <button
            disabled={busy}
            className="w-full rounded-xl border py-2 font-medium hover:shadow"
          >
            {busy ? "Saving…" : "Save & continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
