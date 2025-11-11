import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Upload,
  FileDown,
  Trash2,
  Loader2,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { supabase } from "../lib/supabase";

/**
 * TruckDocumentsModal
 * - Storage bucket: 'truck-docs'
 * - Path scheme:  <truck.id>/<docType>/<timestamp>__<originalName>
 *
 * Props:
 *  - open: boolean
 *  - onClose: () => void
 *  - truck: { id, truck_number, vin, make, model }
 */
export default function TruckDocumentsModal({ open, onClose, truck }) {
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState([]);
  const [error, setError] = useState(null);
  const [docType, setDocType] = useState("Registration");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const inputRef = useRef(null);

  const bucket = "truck-docs";

  const title = useMemo(() => {
    if (!truck) return "Truck Documents";
    // First truthy value from these candidates:
    const name =
      [truck.truck_number, truck.vin, `${truck.make || ""} ${truck.model || ""}`.trim(), truck.id]
        .filter(Boolean)[0] || "Truck";
    return `Documents â€¢ ${name}`;
  }, [truck]);

  useEffect(() => {
    if (!open || !truck?.id) return;
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, truck?.id]);

  async function fetchList() {
    if (!truck?.id) return;
    setRefreshing(true);
    setError(null);
    try {
      const prefix = `${truck.id}/`;

      // Try flat recursive-like read; if SDK doesnâ€™t support recursive, fall back to known folders.
      const { data, error: listErr } = await supabase.storage
        .from(bucket)
        .list(prefix, {
          limit: 1000,
          offset: 0,
          sortBy: { column: "name", order: "asc" },
        });

      if (listErr) throw listErr;

      let files = [];
      // Some SDK versions return folder entries (no metadata). If so, list each subfolder manually.
      const looksLikeFolders = (data || []).some((d) => d.id == null && !d.metadata);
      if (looksLikeFolders) {
        const folders = ["Registration", "Inspection", "IFTA", "Insurance", "Other"];
        for (const f of folders) {
          const { data: sub, error: subErr } = await supabase.storage
            .from(bucket)
            .list(`${truck.id}/${f}`, {
              limit: 1000,
              offset: 0,
              sortBy: { column: "name", order: "asc" },
            });
          if (subErr) continue;
          files = files.concat((sub || []).map((s) => ({ ...s, name: `${f}/${s.name}` })));
        }
      } else {
        // If we actually got files, theyâ€™ll have metadata.mimetype.
        files = (data || []).filter((it) => it?.metadata?.mimetype).map((f) => ({ ...f, name: f.name.replace(prefix, "") }));
      }

      setListing(files);
    } catch (e) {
      setError(
        e?.message ||
          "Failed to list documents. Ensure the 'truck-docs' bucket exists and policies allow access."
      );
    } finally {
      setRefreshing(false);
    }
  }

  function resetUpload() {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function doUpload(e) {
    e?.preventDefault?.();
    if (!truck?.id || !file) return;
    setUploading(true);
    setError(null);
    try {
      const safeName = file.name.replace(/[^\w.\-()+\s]/g, "_");
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const path = `${truck.id}/${docType}/${ts}__${safeName}`;

      const { error: upErr } = await supabase.storage
        .from(bucket)
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (upErr) throw upErr;

      resetUpload();
      await fetchList();
    } catch (e2) {
      setError(
        e2?.message ||
          "Upload failed. Verify bucket/policies and file size limits."
      );
    } finally {
      setUploading(false);
    }
  }

  async function doDelete(name) {
    if (!truck?.id || !name) return;
    setBusy(true);
    setError(null);
    try {
      const path = `${truck.id}/${name}`;
      const { error: delErr } = await supabase.storage.from(bucket).remove([path]);
      if (delErr) throw delErr;
      await fetchList();
    } catch (e) {
      setError(e?.message || "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function doDownload(name) {
    if (!truck?.id || !name) return;
    setBusy(true);
    setError(null);
    try {
      const path = `${truck.id}/${name}`;
      const { data, error: dlErr } = await supabase.storage.from(bucket).download(path);
      if (dlErr) throw dlErr;

      const blobUrl = URL.createObjectURL(data);
      const a = document.createElement("a");
      const part = name.split("/").pop() || "document";
      a.href = blobUrl;
      a.download = part;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      setError(e?.message || "Download failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl rounded-2xl border bg-[var(--panel)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="font-semibold text-lg">{title}</div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/5 transition"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 px-3 py-2 text-sm">
              {String(error).includes("not found") ? (
                <div>
                  Storage bucket <code>truck-docs</code> not found. Create it in Supabase
                  Storage and ensure your policies allow:
                  <ul className="list-disc ml-5 mt-2">
                    <li>Authenticated users: SELECT on objects</li>
                    <li>Authenticated users: INSERT/DELETE (scoped by org/tenant)</li>
                  </ul>
                </div>
              ) : (
                error
              )}
            </div>
          )}

          {/* Upload row */}
          <form
            onSubmit={doUpload}
            className="grid md:grid-cols-[160px_1fr_auto] gap-2 items-center"
          >
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="px-3 py-2 rounded-xl border bg-transparent"
            >
              <option>Registration</option>
              <option>Inspection</option>
              <option>IFTA</option>
              <option>Insurance</option>
              <option>Other</option>
            </select>

            <input
              ref={inputRef}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="px-3 py-2 rounded-xl border bg-transparent"
            />

            <button
              type="submit"
              disabled={!file || uploading}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border bg-[var(--bg-active)] disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploadingâ€¦
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Upload
                </>
              )}
            </button>
          </form>

          {/* List header */}
          <div className="flex items-center justify-between mt-2">
            <div className="text-sm opacity-70 flex items-center gap-2">
              <FolderOpen className="w-4 h-4" />
              Stored in <code className="opacity-90">truck-docs</code> /{" "}
              <code className="opacity-90">{truck?.id}</code>
            </div>
            <button
              onClick={fetchList}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm hover:bg-[var(--bg-hover)]"
            >
              {refreshing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Refreshingâ€¦
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </>
              )}
            </button>
          </div>

          {/* Files table */}
          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-black/10 text-left text-[var(--text-soft)]">
                <tr>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">File</th>
                  <th className="px-3 py-3 w-40">Uploaded</th>
                  <th className="px-3 py-3 text-right w-40">Actions</th>
                </tr>
              </thead>
              <tbody>
                {listing.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-10 text-center opacity-70">
                      No documents yet.
                    </td>
                  </tr>
                ) : (
                  listing.map((it, idx) => {
                    const zebra = idx % 2 ? "bg-black/5" : "";
                    // it.name like "Registration/2025-11-04T19-02-11-000Z__file.pdf"
                    const [type, rest] = (it.name || "").split("/", 2);
                    const prettyType = type || "â€”";
                    const prettyName = rest || it.name || "â€”";

                    // Try to display timestamp prefix in a friendly way (fallback to â€” if unparsable)
                    let uploaded = "â€”";
                    if (rest?.includes("__")) {
                      const tsRaw = rest.split("__")[0]; // e.g. 2025-11-04T19-02-11-000Z
                      // Best-effort human-readable display without strict parsing:
                      uploaded = tsRaw.replace("T", " ").replace(/-/g, ":");
                    }

                    return (
                      <tr key={it.id || it.name} className={zebra}>
                        <td className="px-3 py-3 whitespace-nowrap">{prettyType}</td>
                        <td className="px-3 py-3">{prettyName}</td>
                        <td className="px-3 py-3 whitespace-nowrap">{uploaded}</td>
                        <td className="px-3 py-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              onClick={() => doDownload(it.name)}
                              className="px-2 py-1 rounded-lg border hover:bg-[var(--bg-hover)]"
                              title="Download"
                              disabled={busy}
                            >
                              <FileDown className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => doDelete(it.name)}
                              className="px-2 py-1 rounded-lg border hover:bg-[var(--bg-hover)] text-red-300 border-red-500/30"
                              title="Delete"
                              disabled={busy}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-xl border hover:bg-[var(--bg-hover)]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

