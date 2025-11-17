// FILE: src/pages/Drivers.jsx
// Purpose: Drivers page with org-aware RLS-safe CRUD.
// - Loads drivers for the current user's active org (from team_members).
// - Creates drivers with org_id + created_by so RLS "WITH CHECK" passes.
// - Simple inline table UI (you can enhance styling/columns as needed).

import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  Pencil,
  Check,
  X,
  Plus,
  Trash2,
  RefreshCw,
  Search as SearchIcon,
  Loader2,
  AlertTriangle,
} from "lucide-react";

/* ---------------------------- helpers ---------------------------- */
function cx(...a) {
  return a.filter(Boolean).join(" ");
}
function cleanStr(v) {
  return (v ?? "").toString().trim();
}
function isBlank(v) {
  return cleanStr(v) === "";
}
function toast(setToast, tone, msg) {
  setToast({ tone, msg });
  setTimeout(() => {
    setToast(null);
  }, 3500);
}

/* ============================== PAGE ============================== */

export default function Drivers() {
  /* --------- base state --------- */
  const [userId, setUserId] = useState(null);
  const [orgId, setOrgId] = useState(null);

  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [newDraft, setNewDraft] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    license_number: "",
    license_class: "",
    status: "ACTIVE",
    notes: "",
  });

  const [savingId, setSavingId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [toastState, setToast] = useState(null);
  const [fatalError, setFatalError] = useState("");

  /* --------- derive visible rows --------- */
  const visibleDrivers = useMemo(() => {
    const term = cleanStr(search).toLowerCase();
    if (!term) return drivers;
    return drivers.filter((d) => {
      const fields = [
        d.first_name,
        d.last_name,
        d.email,
        d.phone,
        d.license_number,
        d.status,
      ];
      return fields.some((v) => cleanStr(v).toLowerCase().includes(term));
    });
  }, [drivers, search]);

  /* ================== INITIAL LOAD: USER + ORG ================== */

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        setLoading(true);

        // 1) Get current user
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();

        if (userErr) throw userErr;
        if (!user) {
          setFatalError("No authenticated user. Please log in again.");
          setLoading(false);
          return;
        }

        if (cancelled) return;

        setUserId(user.id);

        // 2) Get user's active/default org from team_members
        const { data: member, error: memberErr } = await supabase
          .from("team_members")
          .select("org_id, status, is_default")
          .eq("user_id", user.id)
          .eq("status", "active")
          .order("is_default", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (memberErr) throw memberErr;
        if (!member) {
          setFatalError(
            "You do not belong to an active organization. Ask your admin to add you to an org."
          );
          setLoading(false);
          return;
        }

        if (cancelled) return;

        setOrgId(member.org_id);

        // 3) Load drivers for this org
        await loadDrivers(member.org_id);
      } catch (err) {
        console.error("[Drivers] init error:", err);
        setFatalError(
          err?.message ||
          "Something went wrong while loading drivers. Please try again."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();

    return () => {
      cancelled = true;
    };
  }, []);

  /* ====================== LOAD DRIVERS ====================== */

  const loadDrivers = useCallback(
    async (orgIdParam) => {
      const oid = orgIdParam || orgId;
      if (!oid) return;

      try {
        if (!orgIdParam) setRefreshing(true);

        const { data, error } = await supabase
          .from("drivers")
          .select(
            `
              id,
              org_id,
              first_name,
              last_name,
              email,
              phone,
              license_number,
              license_class,
              license_expiry,
              med_card_expiry,
              status,
              notes,
              created_by,
              created_at,
              updated_at
            `
          )
          .eq("org_id", oid)
          .order("created_at", { ascending: false });

        if (error) throw error;

        setDrivers(data || []);
      } catch (err) {
        console.error("[Drivers] load error:", err);
        toast(
          setToast,
          "error",
          err?.message || "Failed to load drivers for this organization."
        );
      } finally {
        if (!orgIdParam) setRefreshing(false);
      }
    },
    [orgId]
  );

  /* ====================== CREATE DRIVER ====================== */

  async function createDriver() {
    try {
      setCreating(true);
      setFatalError("");

      if (!userId || !orgId) {
        toast(
          setToast,
          "error",
          "Missing user/org context. Try refreshing the page or logging in again."
        );
        return;
      }

      // Validate required fields (match your NOT NULL constraints)
      if (isBlank(newDraft.last_name)) {
        toast(setToast, "error", "Last name is required.");
        return;
      }

      // Build row that matches RLS expectations:
      // - org_id = current org
      // - created_by = auth.uid() (if your policy checks this)
      const payload = {
        org_id: orgId,
        created_by: userId,
        first_name: cleanStr(newDraft.first_name) || null,
        last_name: cleanStr(newDraft.last_name),
        email: cleanStr(newDraft.email) || null,
        phone: cleanStr(newDraft.phone) || null,
        license_number: cleanStr(newDraft.license_number) || null,
        license_class: cleanStr(newDraft.license_class) || null,
        status: cleanStr(newDraft.status) || "ACTIVE",
        notes: cleanStr(newDraft.notes) || null,
      };

      console.log("[Drivers] create payload:", payload);

      const { data, error } = await supabase
        .from("drivers")
        .insert([payload])
        .select(
          `
            id,
            org_id,
            first_name,
            last_name,
            email,
            phone,
            license_number,
            license_class,
            license_expiry,
            med_card_expiry,
            status,
            notes,
            created_by,
            created_at,
            updated_at
          `
        )
        .single();

      if (error) {
        console.error("[Drivers] create driver error:", error);
        // If you still hit RLS, you'll see it here with full message.
        toast(
          setToast,
          "error",
          error.message ||
            "Create failed. RLS rejected this row. Check org_id/created_by policy."
        );
        return;
      }

      setDrivers((prev) => [data, ...prev]);

      // Reset form
      setNewDraft({
        first_name: "",
        last_name: "",
        email: "",
        phone: "",
        license_number: "",
        license_class: "",
        status: "ACTIVE",
        notes: "",
      });

      toast(setToast, "success", "Driver created.");
    } catch (err) {
      console.error("[Drivers] create driver exception:", err);
      toast(
        setToast,
        "error",
        err?.message || "Unexpected error while creating driver."
      );
    } finally {
      setCreating(false);
    }
  }

  /* ======================= UPDATE DRIVER ======================= */

  async function saveEdit(id) {
    try {
      if (!id) return;
      setSavingId(id);

      const original = drivers.find((d) => d.id === id);
      if (!original) return;

      const payload = {
        first_name:
          cleanStr(editDraft.first_name ?? original.first_name) || null,
        last_name:
          cleanStr(editDraft.last_name ?? original.last_name) || null,
        email: cleanStr(editDraft.email ?? original.email) || null,
        phone: cleanStr(editDraft.phone ?? original.phone) || null,
        license_number:
          cleanStr(editDraft.license_number ?? original.license_number) ||
          null,
        license_class:
          cleanStr(editDraft.license_class ?? original.license_class) ||
          null,
        status: cleanStr(editDraft.status ?? original.status) || "ACTIVE",
        notes: cleanStr(editDraft.notes ?? original.notes) || null,
      };

      const { data, error } = await supabase
        .from("drivers")
        .update(payload)
        .eq("id", id)
        .eq("org_id", orgId)
        .select(
          `
            id,
            org_id,
            first_name,
            last_name,
            email,
            phone,
            license_number,
            license_class,
            license_expiry,
            med_card_expiry,
            status,
            notes,
            created_by,
            created_at,
            updated_at
          `
        )
        .single();

      if (error) {
        console.error("[Drivers] update error:", error);
        toast(
          setToast,
          "error",
          error.message || "Update failed. Check RLS / required fields."
        );
        return;
      }

      setDrivers((prev) =>
        prev.map((d) => (d.id === id ? { ...d, ...data } : d))
      );
      setEditingId(null);
      setEditDraft({});
      toast(setToast, "success", "Driver updated.");
    } catch (err) {
      console.error("[Drivers] saveEdit exception:", err);
      toast(
        setToast,
        "error",
        err?.message || "Unexpected error while saving changes."
      );
    } finally {
      setSavingId(null);
    }
  }

  function startEdit(row) {
    setEditingId(row.id);
    setEditDraft({
      first_name: row.first_name ?? "",
      last_name: row.last_name ?? "",
      email: row.email ?? "",
      phone: row.phone ?? "",
      license_number: row.license_number ?? "",
      license_class: row.license_class ?? "",
      status: row.status ?? "ACTIVE",
      notes: row.notes ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft({});
  }

  /* ======================= DELETE DRIVER ======================= */

  async function deleteDriver(id) {
    if (!id) return;
    if (!window.confirm("Delete this driver? This cannot be undone.")) return;

    try {
      setDeletingId(id);
      const { error } = await supabase
        .from("drivers")
        .delete()
        .eq("id", id)
        .eq("org_id", orgId);

      if (error) {
        console.error("[Drivers] delete error:", error);
        toast(
          setToast,
          "error",
          error.message || "Delete failed. Check RLS / permissions."
        );
        return;
      }

      setDrivers((prev) => prev.filter((d) => d.id !== id));
      toast(setToast, "success", "Driver deleted.");
    } catch (err) {
      console.error("[Drivers] delete exception:", err);
      toast(
        setToast,
        "error",
        err?.message || "Unexpected error while deleting driver."
      );
    } finally {
      setDeletingId(null);
    }
  }

  /* =========================== RENDER =========================== */

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-300">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading drivers…</span>
        </div>
      </div>
    );
  }

  if (fatalError) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 flex items-start gap-3 text-sm text-red-100">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div>
            <div className="font-semibold mb-1">Cannot load drivers</div>
            <div>{fatalError}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">
            Drivers
          </h1>
          <p className="text-xs text-slate-400">
            Org-scoped list of drivers. All actions respect Row Level
            Security.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => loadDrivers()}
            disabled={refreshing}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium",
              "border-slate-700 bg-slate-900/60 hover:bg-slate-800/80",
              refreshing && "opacity-70 cursor-not-allowed"
            )}
          >
            <RefreshCw
              className={cx(
                "w-3.5 h-3.5",
                refreshing && "animate-spin"
              )}
            />
            <span>Refresh</span>
          </button>

          <button
            onClick={createDriver}
            disabled={creating || !orgId}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium",
              "border-emerald-500/50 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20",
              (creating || !orgId) && "opacity-60 cursor-not-allowed"
            )}
          >
            {creating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            <span>New driver</span>
          </button>
        </div>
      </div>

      {/* New driver quick form */}
      <div className="rounded-xl border border-slate-700/80 bg-slate-950/60 p-3 flex flex-wrap gap-2 items-center text-xs">
        <span className="text-slate-400 mr-2">New driver:</span>
        <input
          className="min-w-[120px] rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 placeholder-slate-500"
          placeholder="First name"
          value={newDraft.first_name}
          onChange={(e) =>
            setNewDraft((d) => ({ ...d, first_name: e.target.value }))
          }
        />
        <input
          className="min-w-[120px] rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 placeholder-slate-500"
          placeholder="Last name (required)"
          value={newDraft.last_name}
          onChange={(e) =>
            setNewDraft((d) => ({ ...d, last_name: e.target.value }))
          }
        />
        <input
          className="min-w-[160px] rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 placeholder-slate-500"
          placeholder="Email"
          value={newDraft.email}
          onChange={(e) =>
            setNewDraft((d) => ({ ...d, email: e.target.value }))
          }
        />
        <input
          className="min-w-[120px] rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 placeholder-slate-500"
          placeholder="Phone"
          value={newDraft.phone}
          onChange={(e) =>
            setNewDraft((d) => ({ ...d, phone: e.target.value }))
          }
        />
        <input
          className="min-w-[120px] rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 placeholder-slate-500"
          placeholder="License #"
          value={newDraft.license_number}
          onChange={(e) =>
            setNewDraft((d) => ({
              ...d,
              license_number: e.target.value,
            }))
          }
        />
        <input
          className="min-w-[80px] rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 placeholder-slate-500"
          placeholder="Class"
          value={newDraft.license_class}
          onChange={(e) =>
            setNewDraft((d) => ({
              ...d,
              license_class: e.target.value,
            }))
          }
        />
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            className="w-full rounded-lg border border-slate-700 bg-slate-950/70 pl-7 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500"
            placeholder="Search drivers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="text-[11px] text-slate-500">
          {visibleDrivers.length} of {drivers.length} drivers
        </span>
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-xl border border-slate-800 bg-slate-950/70">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-950/90 border-b border-slate-800/80">
            <tr className="text-[11px] text-slate-400">
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Phone</th>
              <th className="px-3 py-2 text-left">License</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left w-12"></th>
            </tr>
          </thead>
          <tbody>
            {visibleDrivers.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-4 text-center text-slate-500"
                >
                  No drivers found.
                </td>
              </tr>
            ) : (
              visibleDrivers.map((row) => {
                const isEditing = editingId === row.id;
                return (
                  <tr
                    key={row.id}
                    className="border-t border-slate-800/80 hover:bg-slate-900/40"
                  >
                    {/* NAME */}
                    <td className="px-3 py-1.5">
                      {isEditing ? (
                        <div className="flex gap-1">
                          <input
                            className="w-24 rounded-md border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-100"
                            value={editDraft.first_name}
                            onChange={(e) =>
                              setEditDraft((d) => ({
                                ...d,
                                first_name: e.target.value,
                              }))
                            }
                          />
                          <input
                            className="w-28 rounded-md border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-100"
                            value={editDraft.last_name}
                            onChange={(e) =>
                              setEditDraft((d) => ({
                                ...d,
                                last_name: e.target.value,
                              }))
                            }
                          />
                        </div>
                      ) : (
                        <div className="flex flex-col">
                          <span className="text-slate-100">
                            {row.first_name} {row.last_name}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            ID: {row.id?.slice(0, 8)}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* EMAIL */}
                    <td className="px-3 py-1.5">
                      {isEditing ? (
                        <input
                          className="w-full max-w-[190px] rounded-md border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-100"
                          value={editDraft.email}
                          onChange={(e) =>
                            setEditDraft((d) => ({
                              ...d,
                              email: e.target.value,
                            }))
                          }
                        />
                      ) : (
                        <span className="text-slate-200">
                          {row.email || "—"}
                        </span>
                      )}
                    </td>

                    {/* PHONE */}
                    <td className="px-3 py-1.5">
                      {isEditing ? (
                        <input
                          className="w-full max-w-[140px] rounded-md border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-100"
                          value={editDraft.phone}
                          onChange={(e) =>
                            setEditDraft((d) => ({
                              ...d,
                              phone: e.target.value,
                            }))
                          }
                        />
                      ) : (
                        <span className="text-slate-200">
                          {row.phone || "—"}
                        </span>
                      )}
                    </td>

                    {/* LICENSE */}
                    <td className="px-3 py-1.5">
                      {isEditing ? (
                        <div className="flex gap-1">
                          <input
                            className="w-24 rounded-md border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-100"
                            placeholder="#"
                            value={editDraft.license_number}
                            onChange={(e) =>
                              setEditDraft((d) => ({
                                ...d,
                                license_number: e.target.value,
                              }))
                            }
                          />
                          <input
                            className="w-14 rounded-md border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-100"
                            placeholder="Class"
                            value={editDraft.license_class}
                            onChange={(e) =>
                              setEditDraft((d) => ({
                                ...d,
                                license_class: e.target.value,
                              }))
                            }
                          />
                        </div>
                      ) : (
                        <div className="flex flex-col">
                          <span className="text-slate-200">
                            {row.license_number || "—"}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {row.license_class || ""}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* STATUS */}
                    <td className="px-3 py-1.5">
                      {isEditing ? (
                        <input
                          className="w-20 rounded-md border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-100"
                          value={editDraft.status}
                          onChange={(e) =>
                            setEditDraft((d) => ({
                              ...d,
                              status: e.target.value,
                            }))
                          }
                        />
                      ) : (
                        <span
                          className={cx(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                            row.status === "ACTIVE"
                              ? "bg-emerald-500/10 text-emerald-200 border border-emerald-500/40"
                              : "bg-slate-700/40 text-slate-200 border border-slate-500/40"
                          )}
                        >
                          {row.status || "—"}
                        </span>
                      )}
                    </td>

                    {/* ACTIONS */}
                    <td className="px-3 py-1.5 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => saveEdit(row.id)}
                            disabled={savingId === row.id}
                            className={cx(
                              "inline-flex items-center justify-center rounded-md border px-1.5 py-0.5",
                              "border-emerald-500/60 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20",
                              savingId === row.id &&
                                "opacity-60 cursor-not-allowed"
                            )}
                          >
                            {savingId === row.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Check className="w-3 h-3" />
                            )}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="inline-flex items-center justify-center rounded-md border border-slate-600 bg-slate-900/80 px-1.5 py-0.5 text-slate-200 hover:bg-slate-800"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => startEdit(row)}
                            className="inline-flex items-center justify-center rounded-md border border-slate-600 bg-slate-900/80 px-1.5 py-0.5 text-slate-200 hover:bg-slate-800"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => deleteDriver(row.id)}
                            disabled={deletingId === row.id}
                            className={cx(
                              "inline-flex items-center justify-center rounded-md border px-1.5 py-0.5",
                              "border-red-500/60 bg-red-500/10 text-red-100 hover:bg-red-500/20",
                              deletingId === row.id &&
                                "opacity-60 cursor-not-allowed"
                            )}
                          >
                            {deletingId === row.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Trash2 className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Toast */}
      {toastState && (
        <div className="fixed bottom-4 right-4 z-40">
          <div
            className={cx(
              "rounded-lg px-3 py-2 text-xs shadow-lg border backdrop-blur bg-slate-950/90",
              toastState.tone === "error"
                ? "border-red-500/60 text-red-100"
                : "border-emerald-500/60 text-emerald-100"
            )}
          >
            {toastState.msg}
          </div>
        </div>
      )}
    </div>
  );
}
