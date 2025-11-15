// FILE: src/pages/DriverProfile.jsx
// Purpose: Driver Profile page with editable "preferences" (JSONB) that AI + dispatch can use.
// - Works even if `preferences` column doesn't exist (shows a banner; rest still loads).
// - Fields saved into drivers.preferences (json/jsonb): equipment_types, lane_whitelist, lane_blacklist,
//   home_days, shift, max_weight_lbs, distance_radius_miles, avoid_customers, certifications (twic/tsa/dod),
//   languages, notes.
// - Conservative, enterprise styling consistent with Atlas Command.

// Usage:
//  - Route: <Route path="/drivers/:id" element={<DriverProfile />} />
//  - From your Drivers list, link to `/drivers/${driver.id}`

import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  ArrowLeft,
  RefreshCw,
  Save,
  Loader2,
  AlertTriangle,
} from "lucide-react";

/* ---------------------------- helpers ---------------------------- */
function cx(...a) { return a.filter(Boolean).join(" "); }
const asArray = (v) => Array.isArray(v) ? v : (typeof v === "string" && v.trim() ? v.split(",").map(s => s.trim()).filter(Boolean) : []);
const asString = (arr) => Array.isArray(arr) ? arr.join(", ") : (arr ?? "");
const toInt = (v) => {
  const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

function toast(setToast, tone, msg) {
  setToast({ tone, msg });
  setTimeout(() => setToast(null), 2400);
}

/* ------------------------- tiny toast UI ------------------------- */
function Toast({ tone = "zinc", msg = "" }) {
  if (!msg) return null;
  const t =
    tone === "red"
      ? "bg-red-600 text-white"
      : tone === "green"
      ? "bg-emerald-600 text-white"
      : "bg-zinc-800 text-zinc-100";
  return (
    <div className={cx("fixed bottom-5 right-5 px-4 py-2 rounded-lg shadow-lg z-50", t)}>
      {msg}
    </div>
  );
}

/* ------------------------- main page ----------------------------- */
export default function DriverProfile() {
  const { id } = useParams();
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toastState, setToast] = useState(null);

  const [driver, setDriver] = useState(null);
  const [knownCols, setKnownCols] = useState([]); // detect if "preferences" exists
  const [prefs, setPrefs] = useState({
    equipment_types: [],           // e.g., ["dry van","flatbed","stepdeck","rgn","reefer"]
    lane_whitelist: [],            // e.g., ["Sacramento, CA → Phoenix, AZ"]
    lane_blacklist: [],            // e.g., ["Portland, OR"]
    home_days: [],                 // e.g., ["Fri","Sat"]
    shift: "either",               // "day" | "night" | "either"
    max_weight_lbs: null,          // number
    distance_radius_miles: null,   // number (home radius)
    avoid_customers: [],           // e.g., ["Shipper A","Consignee B"]
    certifications: {              // booleans
      twic: false,
      tsa: false,
      dod_clearance: false,
    },
    languages: [],                 // e.g., ["English","Russian","Ukrainian"]
    notes: "",                     // free text
  });

  const hasPreferencesCol = useMemo(() => knownCols.includes("preferences"), [knownCols]);

  const fetchDriver = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("fetch driver error:", error);
      toast(setToast, "red", `Load failed: ${error.message}`);
      setLoading(false);
      return;
    }
    if (!data) {
      toast(setToast, "red", "Driver not found.");
      setLoading(false);
      return;
    }

    // Collect known cols
    const cols = Object.keys(data || {});
    setKnownCols(cols);

    // Merge defaults with existing preferences if present
    const incoming = (data.preferences && typeof data.preferences === "object") ? data.preferences : {};
    setPrefs((d) => ({
      ...d,
      ...incoming,
      equipment_types: asArray(incoming.equipment_types),
      lane_whitelist: asArray(incoming.lane_whitelist),
      lane_blacklist: asArray(incoming.lane_blacklist),
      home_days: asArray(incoming.home_days),
      languages: asArray(incoming.languages),
      avoid_customers: asArray(incoming.avoid_customers),
      shift: incoming.shift ?? "either",
      max_weight_lbs: incoming.max_weight_lbs ?? null,
      distance_radius_miles: incoming.distance_radius_miles ?? null,
      certifications: {
        twic: Boolean(incoming?.certifications?.twic),
        tsa: Boolean(incoming?.certifications?.tsa),
        dod_clearance: Boolean(incoming?.certifications?.dod_clearance),
      },
      notes: incoming.notes ?? "",
    }));

    setDriver(data);
    setLoading(false);
  };

  useEffect(() => {
    if (id) fetchDriver();
  }, [id]);

  const onSave = async () => {
    if (!hasPreferencesCol) {
      toast(setToast, "red", "No preferences column on drivers. Add it first (see banner).");
      return;
    }
    try {
      setSaving(true);
      const payload = { preferences: {
        ...prefs,
        equipment_types: asArray(prefs.equipment_types),
        lane_whitelist: asArray(prefs.lane_whitelist),
        lane_blacklist: asArray(prefs.lane_blacklist),
        home_days: asArray(prefs.home_days),
        languages: asArray(prefs.languages),
        avoid_customers: asArray(prefs.avoid_customers),
        shift: prefs.shift ?? "either",
        max_weight_lbs: prefs.max_weight_lbs ?? null,
        distance_radius_miles: prefs.distance_radius_miles ?? null,
        certifications: {
          twic: Boolean(prefs?.certifications?.twic),
          tsa: Boolean(prefs?.certifications?.tsa),
          dod_clearance: Boolean(prefs?.certifications?.dod_clearance),
        },
        notes: prefs.notes ?? "",
      }};

      const { error } = await supabase
        .from("drivers")
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      toast(setToast, "green", "Preferences saved.");
      await fetchDriver();
    } catch (e) {
      console.error("save preferences error:", e);
      toast(setToast, "red", `Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------- UI bits ---------------------------- */

  const Banner = () => (!hasPreferencesCol ? (
    <div className="mb-4 p-3 rounded-lg border border-amber-700/40 bg-amber-600/10 text-amber-200 flex items-start gap-2">
      <AlertTriangle className="w-4 h-4 mt-0.5" />
      <div className="text-sm">
        <div className="font-medium">Preferences column not found.</div>
        <div className="opacity-90">
          Run this once, then refresh:
          <pre className="mt-2 p-2 rounded bg-zinc-900/60 border border-zinc-700 text-xs overflow-auto">
            {`alter table public.drivers
add column if not exists preferences jsonb not null default '{}';`}
          </pre>
        </div>
      </div>
    </div>
  ) : null);

  const Section = ({ title, children }) => (
    <div className="border border-zinc-800 rounded-xl p-4 bg-zinc-900/40">
      <div className="text-zinc-100 font-medium mb-3">{title}</div>
      {children}
    </div>
  );

  const Row = ({ label, children, help }) => (
    <div className="grid grid-cols-12 gap-3 items-start mb-3">
      <div className="col-span-12 md:col-span-3 text-sm text-zinc-300 pt-2">{label}</div>
      <div className="col-span-12 md:col-span-9">
        {children}
        {help && <div className="text-xs text-zinc-400 mt-1">{help}</div>}
      </div>
    </div>
  );

  const TextInput = (props) => (
    <input
      {...props}
      className={cx(
        "w-full px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-700 text-sm",
        props.className
      )}
    />
  );

  const TextArea = (props) => (
    <textarea
      {...props}
      rows={4}
      className={cx(
        "w-full px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-700 text-sm",
        props.className
      )}
    />
  );

  const Check = ({ label, checked, onChange }) => (
    <label className="inline-flex items-center gap-2 text-sm text-zinc-200 mr-4">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-zinc-600 bg-zinc-900"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );

  if (loading) {
    return (
      <div className="p-6">
        <div className="mb-4">
          <Link to="/drivers" className="inline-flex items-center gap-2 text-sm text-zinc-300 hover:text-zinc-100">
            <ArrowLeft className="w-4 h-4" /> Back to Drivers
          </Link>
        </div>
        <div className="rounded-xl border border-zinc-800 p-10 text-center text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" />
          Loading driver…
        </div>
      </div>
    );
  }

  if (!driver) {
    return (
      <div className="p-6">
        <div className="mb-4">
          <button onClick={() => nav(-1)} className="inline-flex items-center gap-2 text-sm text-zinc-300 hover:text-zinc-100">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        </div>
        <div className="rounded-xl border border-zinc-800 p-10 text-center text-zinc-400">
          Driver not found.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <Toast {...(toastState || {})} />

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link to="/drivers" className="inline-flex items-center gap-2 text-sm text-zinc-300 hover:text-zinc-100">
            <ArrowLeft className="w-4 h-4" /> Drivers
          </Link>
          <div className="text-lg text-zinc-500">/</div>
          <div>
            <div className="text-2xl font-semibold text-zinc-100">{driver.full_name || driver.name || "Driver"}</div>
            <div className="text-zinc-400 text-sm">ID: {String(driver.id).slice(0, 8)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-700 hover:bg-zinc-800"
            onClick={fetchDriver}
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-700 bg-emerald-600/20 hover:bg-emerald-600/30"
            onClick={onSave}
            disabled={saving || !hasPreferencesCol}
            title={!hasPreferencesCol ? "Add preferences column first" : "Save preferences"}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>

      <Banner />

      {/* Content */}
      <div className="grid grid-cols-12 gap-5">
        {/* Left: core info (read-only quick glance) */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          <Section title="Driver">
            <div className="text-sm text-zinc-300 space-y-2">
              <div><span className="text-zinc-400">Name:</span> {driver.full_name || driver.name || "—"}</div>
              <div><span className="text-zinc-400">Phone:</span> {driver.phone || "—"}</div>
              <div><span className="text-zinc-400">Email:</span> {driver.email || "—"}</div>
              <div><span className="text-zinc-400">Status:</span> {driver.status || driver.state || "—"}</div>
              <div><span className="text-zinc-400">Truck:</span> {driver.truck_id || driver.truck || driver.vehicle_id || "—"}</div>
              {driver.notes && (
                <div>
                  <div className="text-zinc-400">Notes:</div>
                  <div className="mt-1 text-zinc-200 whitespace-pre-wrap">{driver.notes}</div>
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* Right: preferences editor */}
        <div className="col-span-12 lg:col-span-8 space-y-4">
          <Section title="Preferences">
            <Row
              label="Equipment types"
              help="Comma-separated. Example: dry van, flatbed, stepdeck, rgn, reefer"
            >
              <TextInput
                placeholder="dry van, flatbed, stepdeck…"
                value={asString(prefs.equipment_types)}
                onChange={(e) => setPrefs((d) => ({ ...d, equipment_types: asArray(e.target.value) }))}
              />
            </Row>

            <Row
              label="Preferred lanes"
              help="Comma-separated (free text or City, ST → City, ST). Example: Sacramento, CA → Phoenix, AZ"
            >
              <TextInput
                placeholder="Sacramento, CA → Phoenix, AZ, Los Angeles, CA → Reno, NV"
                value={asString(prefs.lane_whitelist)}
                onChange={(e) => setPrefs((d) => ({ ...d, lane_whitelist: asArray(e.target.value) }))}
              />
            </Row>

            <Row
              label="Avoid lanes/regions"
              help="Comma-separated. Example: Portland, OR, NYC metro"
            >
              <TextInput
                placeholder="Portland, OR, NYC metro"
                value={asString(prefs.lane_blacklist)}
                onChange={(e) => setPrefs((d) => ({ ...d, lane_blacklist: asArray(e.target.value) }))}
              />
            </Row>

            <Row
              label="Home days"
              help="Comma-separated: Mon, Tue, Wed, Thu, Fri, Sat, Sun"
            >
              <TextInput
                placeholder="Fri, Sat"
                value={asString(prefs.home_days)}
                onChange={(e) => setPrefs((d) => ({ ...d, home_days: asArray(e.target.value) }))}
              />
            </Row>

            <Row label="Shift">
              <div className="flex items-center gap-4">
                {["day", "night", "either"].map((v) => (
                  <label key={v} className="inline-flex items-center gap-2 text-sm text-zinc-200">
                    <input
                      type="radio"
                      name="shift"
                      value={v}
                      checked={prefs.shift === v}
                      onChange={() => setPrefs((d) => ({ ...d, shift: v }))}
                    />
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </label>
                ))}
              </div>
            </Row>

            <Row label="Max weight (lbs)">
              <TextInput
                inputMode="numeric"
                placeholder="e.g., 45000"
                value={prefs.max_weight_lbs ?? ""}
                onChange={(e) => setPrefs((d) => ({ ...d, max_weight_lbs: toInt(e.target.value) }))}
              />
            </Row>

            <Row
              label="Home radius (miles)"
              help="Preferred dispatch radius around the driver's home base."
            >
              <TextInput
                inputMode="numeric"
                placeholder="e.g., 100"
                value={prefs.distance_radius_miles ?? ""}
                onChange={(e) => setPrefs((d) => ({ ...d, distance_radius_miles: toInt(e.target.value) }))}
              />
            </Row>

            <Row
              label="Avoid customers"
              help="Comma-separated customer names to avoid."
            >
              <TextInput
                placeholder="Shipper A, Consignee B"
                value={asString(prefs.avoid_customers)}
                onChange={(e) => setPrefs((d) => ({ ...d, avoid_customers: asArray(e.target.value) }))}
              />
            </Row>

            <Row label="Certifications">
              <div className="flex flex-wrap">
                <Check
                  label="TWIC"
                  checked={prefs.certifications?.twic}
                  onChange={(v) => setPrefs((d) => ({ ...d, certifications: { ...d.certifications, twic: v } }))}
                />
                <Check
                  label="TSA"
                  checked={prefs.certifications?.tsa}
                  onChange={(v) => setPrefs((d) => ({ ...d, certifications: { ...d.certifications, tsa: v } }))}
                />
                <Check
                  label="DOD Clearance"
                  checked={prefs.certifications?.dod_clearance}
                  onChange={(v) => setPrefs((d) => ({ ...d, certifications: { ...d.certifications, dod_clearance: v } }))}
                />
              </div>
            </Row>

            <Row
              label="Languages"
              help="Comma-separated. Example: English, Russian, Ukrainian"
            >
              <TextInput
                placeholder="English, Russian, Ukrainian"
                value={asString(prefs.languages)}
                onChange={(e) => setPrefs((d) => ({ ...d, languages: asArray(e.target.value) }))}
              />
            </Row>

            <Row label="Notes">
              <TextArea
                placeholder="Any extra constraints or preferences…"
                value={prefs.notes ?? ""}
                onChange={(e) => setPrefs((d) => ({ ...d, notes: e.target.value }))}
              />
            </Row>
          </Section>
        </div>
      </div>
    </div>
  );
}
