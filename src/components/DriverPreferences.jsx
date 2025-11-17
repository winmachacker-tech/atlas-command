// src/components/DriverPreferences.jsx
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  memo,
} from "react";
import {
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Save,
  MapPin,
  Truck,
  Home,
  FileText,
} from "lucide-react";
import { supabase } from "../lib/supabase";

/**
 * DriverPreferences
 * - Shows feedback stats (thumbs up/down) with live activity feed
 * - Shows and edits actual driver preferences (regions, equipment, home base, etc.)
 * - All queries & realtime scoped by driverId
 * - Single subscription with proper cleanup
 */
function DriverPreferences({ driverId }) {
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState([]);
  const [preferences, setPreferences] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const chRef = useRef(null);

  // Form state for preferences
  const [formData, setFormData] = useState({
    home_base: "",
    preferred_regions: [],
    avoid_states: [],
    equipment: "",
    trailer_type: "",
    max_distance_mi: "",
    notes: "",
  });

  // Safely read vote value from either column name
  const getVoteVal = (row) => row?.vote ?? row?.thumb ?? row?.rating ?? null;

  const up = useMemo(
    () => feedback.filter((f) => getVoteVal(f) === "up").length,
    [feedback]
  );
  const down = useMemo(
    () => feedback.filter((f) => getVoteVal(f) === "down").length,
    [feedback]
  );
  const rate = useMemo(
    () => (up + down ? Math.round((up / (up + down)) * 100) : 0),
    [up, down]
  );

  // Load feedback
  const loadFeedback = useCallback(async () => {
    if (!driverId) return;
    try {
      const { data, error } = await supabase
        .from("driver_feedback")
        .select("*")
        .eq("driver_id", driverId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      setFeedback(data || []);
    } catch (e) {
      console.error("loadFeedback error:", e);
    }
  }, [driverId]);

  // Load preferences
  const loadPreferences = useCallback(async () => {
    if (!driverId) return;
    try {
      const { data, error } = await supabase
        .from("driver_preferences")
        .select("*")
        .eq("driver_id", driverId)
        .maybeSingle();

      if (error) throw error;

      setPreferences(data);
      if (data) {
        setFormData({
          home_base: data.home_base || "",
          preferred_regions: data.preferred_regions || data.regions || [],
          avoid_states: data.avoid_states || [],
          equipment: data.equipment || data.preferred_equipment?.[0] || "",
          trailer_type: data.trailer_type || "",
          max_distance_mi: data.max_distance_mi || data.max_distance || "",
          notes: data.notes || "",
        });
      } else {
        // If no row yet, reset to clean defaults
        setFormData({
          home_base: "",
          preferred_regions: [],
          avoid_states: [],
          equipment: "",
          trailer_type: "",
          max_distance_mi: "",
          notes: "",
        });
      }
    } catch (e) {
      console.error("loadPreferences error:", e);
    }
  }, [driverId]);

  // Initial load when driverId changes
  useEffect(() => {
    if (!driverId) return;
    setLoading(true);
    Promise.all([loadFeedback(), loadPreferences()]).finally(() =>
      setLoading(false)
    );
  }, [driverId, loadFeedback, loadPreferences]);

  // Realtime subscription for feedback
  useEffect(() => {
    if (chRef.current) supabase.removeChannel(chRef.current);

    if (driverId) {
      const ch = supabase
        .channel(`driver-feedback:${driverId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "driver_feedback",
            filter: `driver_id=eq.${driverId}`,
          },
          (payload) => {
            setFeedback((prev) => {
              if (payload.eventType === "INSERT") {
                return [payload.new, ...prev].slice(0, 100);
              }
              if (payload.eventType === "UPDATE") {
                const i = prev.findIndex((r) => r.id === payload.new.id);
                if (i === -1) return prev;
                const copy = [...prev];
                copy[i] = payload.new;
                return copy;
              }
              if (payload.eventType === "DELETE") {
                return prev.filter((r) => r.id !== payload.old.id);
              }
              return prev;
            });
          }
        )
        .subscribe();

      chRef.current = ch;
    }

    return () => {
      if (chRef.current) {
        supabase.removeChannel(chRef.current);
        chRef.current = null;
      }
    };
  }, [driverId]);

  // Vote handler
  async function vote(v) {
    if (!driverId || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("driver_feedback")
        .insert([{ driver_id: driverId, rating: v }]);
      if (error) throw error;
    } catch (e) {
      console.error("vote failed", e);
      alert(e.message || "Could not record feedback");
    } finally {
      setBusy(false);
    }
  }

  // Save preferences
  async function savePreferences() {
    if (!driverId || saving) return;
    setSaving(true);
    try {
      const payload = {
        driver_id: driverId,
        home_base: formData.home_base || null,
        preferred_regions:
          formData.preferred_regions.length > 0
            ? formData.preferred_regions
            : null,
        regions:
          formData.preferred_regions.length > 0
            ? formData.preferred_regions
            : null, // duplicate for compatibility
        avoid_states:
          formData.avoid_states.length > 0 ? formData.avoid_states : null,
        equipment: formData.equipment || null,
        trailer_type: formData.trailer_type || null,
        max_distance_mi: formData.max_distance_mi
          ? parseInt(formData.max_distance_mi)
          : null,
        max_distance: formData.max_distance_mi
          ? parseInt(formData.max_distance_mi)
          : null, // duplicate for compatibility
        notes: formData.notes || null,
      };

      if (preferences) {
        // Update existing
        const { error } = await supabase
          .from("driver_preferences")
          .update(payload)
          .eq("driver_id", driverId);
        if (error) throw error;
      } else {
        // Insert new
        const { error } = await supabase
          .from("driver_preferences")
          .insert([payload]);
        if (error) throw error;
      }

      await loadPreferences();
      setEditing(false);
    } catch (e) {
      console.error("savePreferences error:", e);
      alert(e.message || "Could not save preferences");
    } finally {
      setSaving(false);
    }
  }

  // Handle array inputs (comma-separated)
  const handleArrayInput = useCallback((field, value) => {
    const arr = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setFormData((prev) => ({ ...prev, [field]: arr }));
  }, []);

  // Handle simple text inputs
  const handleTextInput = useCallback((field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  if (loading) {
    return (
      <div className="px-4 py-6 text-zinc-300 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ============= FEEDBACK STATS ============= */}
      <div>
        <div className="text-sm font-medium text-zinc-200 mb-3">
          Feedback &amp; Learning
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <Stat
            title="Thumbs Up"
            value={up}
            tone="emerald"
            icon={<ThumbsUp className="w-4 h-4" />}
          />
          <Stat
            title="Thumbs Down"
            value={down}
            tone="rose"
            icon={<ThumbsDown className="w-4 h-4" />}
          />
          <Stat title="Acceptance Rate" value={`${rate}%`} tone="sky" />
        </div>

        {/* Action bar */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => vote("up")}
            disabled={busy || !driverId}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ThumbsUp className="w-4 h-4" />
            )}
            Up
          </button>
          <button
            onClick={() => vote("down")}
            disabled={busy || !driverId}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-200 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ThumbsDown className="w-4 h-4" />
            )}
            Down
          </button>
        </div>

        {/* Live feed */}
        <details className="rounded-2xl border border-zinc-800/70 overflow-hidden">
          <summary className="px-4 py-3 bg-zinc-900/60 text-sm font-semibold cursor-pointer hover:bg-zinc-900/80">
            Live Activity ({feedback.length})
          </summary>
          {feedback.length === 0 ? (
            <div className="px-4 py-6 text-zinc-400">No feedback yet.</div>
          ) : (
            <ul className="divide-y divide-zinc-800/70 max-h-64 overflow-y-auto">
              {feedback.slice(0, 20).map((f) => (
                <li
                  key={f.id}
                  className="px-4 py-3 text-sm flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    {getVoteVal(f) === "up" ? (
                      <ThumbsUp className="w-4 h-4 text-emerald-300" />
                    ) : (
                      <ThumbsDown className="w-4 h-4 text-rose-300" />
                    )}
                    <span className="capitalize text-zinc-300">
                      {getVoteVal(f)}
                    </span>
                  </div>
                  <span className="text-xs text-zinc-500">
                    {new Date(f.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </details>
      </div>

      {/* ============= ACTUAL PREFERENCES ============= */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium text-zinc-200">
            Driver Preferences
          </div>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300"
            >
              Edit
            </button>
          )}
        </div>

        {editing ? (
          // EDIT MODE
          <div className="space-y-4 rounded-2xl border border-zinc-800/70 bg-zinc-900/20 p-4">
            {/* Home Base */}
            <div>
              <label className="flex items-center gap-2 text-xs text-zinc-400 mb-1.5">
                <Home className="w-3.5 h-3.5" />
                Home Base / City
              </label>
              <input
                type="text"
                value={formData.home_base}
                onChange={(e) => handleTextInput("home_base", e.target.value)}
                placeholder="e.g. Dallas, TX"
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
            </div>

            {/* Preferred Regions */}
            <div>
              <label className="flex items-center gap-2 text-xs text-zinc-400 mb-1.5">
                <MapPin className="w-3.5 h-3.5" />
                Preferred Regions (comma-separated)
              </label>
              <input
                type="text"
                value={formData.preferred_regions.join(", ")}
                onChange={(e) =>
                  handleArrayInput("preferred_regions", e.target.value)
                }
                placeholder="e.g. Southwest, West Coast, Midwest"
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
            </div>

            {/* Avoid States */}
            <div>
              <label className="flex items-center gap-2 text-xs text-zinc-400 mb-1.5">
                <MapPin className="w-3.5 h-3.5" />
                Avoid States (comma-separated)
              </label>
              <input
                type="text"
                value={formData.avoid_states.join(", ")}
                onChange={(e) =>
                  handleArrayInput("avoid_states", e.target.value)
                }
                placeholder="e.g. NY, CA, IL"
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
            </div>

            {/* Equipment Type */}
            <div>
              <label className="flex items-center gap-2 text-xs text-zinc-400 mb-1.5">
                <Truck className="w-3.5 h-3.5" />
                Preferred Equipment
              </label>
              <select
                value={formData.equipment}
                onChange={(e) =>
                  handleTextInput("equipment", e.target.value)
                }
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              >
                <option value="">-- Select --</option>
                <option value="Dry Van">Dry Van</option>
                <option value="Reefer">Reefer</option>
                <option value="Flatbed">Flatbed</option>
                <option value="Step Deck">Step Deck</option>
                <option value="Tanker">Tanker</option>
                <option value="Hazmat">Hazmat</option>
              </select>
            </div>

            {/* Trailer Type */}
            <div>
              <label className="flex items-center gap-2 text-xs text-zinc-400 mb-1.5">
                <Truck className="w-3.5 h-3.5" />
                Trailer Type
              </label>
              <input
                type="text"
                value={formData.trailer_type}
                onChange={(e) =>
                  handleTextInput("trailer_type", e.target.value)
                }
                placeholder="e.g. 53ft dry van"
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
            </div>

            {/* Max Distance */}
            <div>
              <label className="flex items-center gap-2 text-xs text-zinc-400 mb-1.5">
                <MapPin className="w-3.5 h-3.5" />
                Max Distance (miles)
              </label>
              <input
                type="number"
                value={formData.max_distance_mi}
                onChange={(e) =>
                  handleTextInput("max_distance_mi", e.target.value)
                }
                placeholder="e.g. 500"
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="flex items-center gap-2 text-xs text-zinc-400 mb-1.5">
                <FileText className="w-3.5 h-3.5" />
                Notes
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => handleTextInput("notes", e.target.value)}
                placeholder="Any special requirements, quirks, or preferences..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40 resize-none"
              />
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={savePreferences}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 text-sky-200 disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Save
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  // Reset form to current preferences
                  if (preferences) {
                    setFormData({
                      home_base: preferences.home_base || "",
                      preferred_regions:
                        preferences.preferred_regions ||
                        preferences.regions ||
                        [],
                      avoid_states: preferences.avoid_states || [],
                      equipment:
                        preferences.equipment ||
                        preferences.preferred_equipment?.[0] ||
                        "",
                      trailer_type: preferences.trailer_type || "",
                      max_distance_mi:
                        preferences.max_distance_mi ||
                        preferences.max_distance ||
                        "",
                      notes: preferences.notes || "",
                    });
                  } else {
                    setFormData({
                      home_base: "",
                      preferred_regions: [],
                      avoid_states: [],
                      equipment: "",
                      trailer_type: "",
                      max_distance_mi: "",
                      notes: "",
                    });
                  }
                }}
                disabled={saving}
                className="px-4 py-2 rounded-lg border border-zinc-700/60 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          // VIEW MODE
          <div className="space-y-3">
            {!preferences ? (
              <div className="text-sm text-zinc-400 italic">
                No preferences set yet.{" "}
                <button
                  onClick={() => setEditing(true)}
                  className="text-sky-400 hover:text-sky-300"
                >
                  Add preferences
                </button>
              </div>
            ) : (
              <>
                {formData.home_base && (
                  <PreferenceRow
                    icon={<Home className="w-4 h-4" />}
                    label="Home Base"
                    value={formData.home_base}
                  />
                )}
                {formData.preferred_regions.length > 0 && (
                  <PreferenceRow
                    icon={<MapPin className="w-4 h-4" />}
                    label="Preferred Regions"
                    value={formData.preferred_regions.join(", ")}
                  />
                )}
                {formData.avoid_states.length > 0 && (
                  <PreferenceRow
                    icon={<MapPin className="w-4 h-4" />}
                    label="Avoid States"
                    value={formData.avoid_states.join(", ")}
                  />
                )}
                {formData.equipment && (
                  <PreferenceRow
                    icon={<Truck className="w-4 h-4" />}
                    label="Equipment"
                    value={formData.equipment}
                  />
                )}
                {formData.trailer_type && (
                  <PreferenceRow
                    icon={<Truck className="w-4 h-4" />}
                    label="Trailer Type"
                    value={formData.trailer_type}
                  />
                )}
                {formData.max_distance_mi && (
                  <PreferenceRow
                    icon={<MapPin className="w-4 h-4" />}
                    label="Max Distance"
                    value={`${formData.max_distance_mi} miles`}
                  />
                )}
                {formData.notes && (
                  <PreferenceRow
                    icon={<FileText className="w-4 h-4" />}
                    label="Notes"
                    value={formData.notes}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============= UI Components ============= */

function Stat({ title, value, tone = "zinc", icon = null }) {
  const tones = {
    emerald: "border-emerald-700/50 bg-emerald-700/10 text-emerald-200",
    rose: "border-rose-700/50 bg-rose-700/10 text-rose-200",
    sky: "border-sky-700/50 bg-sky-700/10 text-sky-200",
    zinc: "border-zinc-700/50 bg-zinc-800/20 text-zinc-200",
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone] || tones.zinc}`}>
      <div className="text-xs opacity-80 flex items-center gap-2">
        {icon}
        {title}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function PreferenceRow({ icon, label, value }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-zinc-800/50 last:border-0">
      <div className="text-zinc-400 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-zinc-500">{label}</div>
        <div className="text-sm text-zinc-200 mt-0.5">{value}</div>
      </div>
    </div>
  );
}

// 🔒 Memoized export: only re-render if driverId actually changes
export default memo(
  DriverPreferences,
  (prevProps, nextProps) => prevProps.driverId === nextProps.driverId
);
