import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  UploadCloud,
  FileText,
  Trash2,
  Download,
  RefreshCw,
  X,
  CheckCircle2,
  Loader2,
  Filter,
} from "lucide-react";

/**
 * LoadDocuments
 * --------------------------------------------------------------------------
 * Drop-in documents manager for a Load.
 * - Stores files in Supabase Storage bucket: "load_docs"
 * - Path scheme: ${loadId}/${docType}/${timestamp}__${safeFilename}
 * - Lists/filters by docType, downloads via signed URL, deletes with confirm
 *
 * REQUIREMENTS:
 * 1) Create a Supabase Storage bucket named "load_docs" (keep it private).
 * 2) RLS/Policies for Storage should allow authenticated users in your org to:
 *    - list objects under a prefix
 *    - upload objects under `${loadId}/**`
 *    - remove objects they own (or admins)
 * 3) Use: <LoadDocuments loadId={theLoadId} />
 */

const DOC_TYPES = [
  "Rate Con",
  "POD",
  "BOL",
  "Invoice",
  "Photos",
  "Other",
];

const MAX_MB = 25;
const ACCEPTED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
];

function bytesToMB(b) {
  return Math.round((b / (1024 * 1024)) * 10) / 10;
}
function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
function safeName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export default function LoadDocuments({ loadId, className = "" }) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedType, setSelectedType] = useState("Rate Con");
  const [filterType, setFilterType] = useState("All");
  const [message, setMessage] = useState("");
  const inputRef = useRef(null);

  const prefix = useMemo(() => {
    if (!loadId) return null;
    return `${loadId}/`;
  }, [loadId]);

  async function listAll() {
    if (!prefix) return;
    setBusy(true);
    try {
      // We need to list per top-level docType folders under this loadId.
      const { data: typeDirs, error: listErr } = await supabase.storage
        .from("load_docs")
        .list(prefix, { limit: 100, offset: 0 });

      if (listErr) throw listErr;

      let all = [];
      // If no subdirs (first time), there may be files at root—also list root.
      const candidates = (typeDirs || []).length ? typeDirs : [{ name: "" , id: "" , created_at:"", updated_at:"", last_accessed_at:"", metadata:null }];
      for (const dir of candidates) {
        const sub = dir.name ? `${prefix}${dir.name}/` : prefix;
        const { data: items, error } = await supabase.storage
          .from("load_docs")
          .list(sub, { limit: 1000, offset: 0 });

        if (error) throw error;
        const mapped =
          items?.map((it) => ({
            name: it.name,
            path: `${sub}${it.name}`,
            size: it.metadata?.size ?? 0,
            updated_at: it.updated_at,
            created_at: it.created_at,
            docType: deriveDocTypeFromPath(`${sub}${it.name}`),
          })) || [];
        all = all.concat(mapped);
      }

      // Sort newest first (by updated_at or filename timestamp)
      all.sort((a, b) => {
        const au = a.updated_at || "";
        const bu = b.updated_at || "";
        return bu.localeCompare(au);
      });
      setFiles(all);
    } catch (err) {
      console.error("[LoadDocuments] listAll error:", err);
      toast(`List error: ${err.message || err}`, "error");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    listAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix]);

  function deriveDocTypeFromPath(path) {
    // path = loadId/docType/filename
    const parts = path.split("/");
    // [loadId, maybeDocType, ...]
    const maybeType = parts[1] || "Other";
    // normalize to a known type if it matches, else "Other"
    const found = DOC_TYPES.find((t) => normalize(t) === normalize(maybeType));
    return found || "Other";
  }

  function normalize(s = "") {
    return String(s).trim().toLowerCase().replace(/\s+/g, "-");
  }

  function toast(msg, type = "info") {
    setMessage(msg);
    if (type !== "info") console[type === "error" ? "error" : "log"]("[LoadDocuments]", msg);
    setTimeout(() => setMessage(""), 3000);
  }

  async function onPickFiles(e) {
    const fl = Array.from(e.target.files || []);
    if (!fl.length) return;
    await doUpload(fl);
    e.target.value = ""; // reset input so same file can be re-selected
  }

  async function doUpload(fileList) {
    if (!prefix) return;
    setUploading(true);
    try {
      // Validate and upload each file
      const results = [];
      for (const file of fileList) {
        if (!ACCEPTED_MIME.includes(file.type)) {
          toast(`Unsupported type: ${file.name}`, "error");
          continue;
        }
        if (bytesToMB(file.size) > MAX_MB) {
          toast(`Too large (> ${MAX_MB}MB): ${file.name}`, "error");
          continue;
        }
        const safe = safeName(file.name);
        const subdir = `${prefix}${selectedType}/`;
        const fullPath = `${subdir}${nowStamp()}__${safe}`;

        const { error: upErr } = await supabase.storage
          .from("load_docs")
          .upload(fullPath, file, {
            cacheControl: "3600",
            upsert: false,
          });

        if (upErr) {
          toast(`Upload failed: ${file.name}`, "error");
          console.error(upErr);
          continue;
        }
        results.push(fullPath);
      }

      if (results.length) {
        toast(`Uploaded ${results.length} file(s).`, "success");
        await listAll();
      }
    } catch (err) {
      console.error("[LoadDocuments] upload error:", err);
      toast(`Upload error: ${err.message || err}`, "error");
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(path) {
    const ok = window.confirm("Delete this file permanently?");
    if (!ok) return;

    try {
      const { error } = await supabase.storage
        .from("load_docs")
        .remove([path]);

      if (error) throw error;
      toast("Deleted.");
      setFiles((prev) => prev.filter((f) => f.path !== path));
    } catch (err) {
      console.error("[LoadDocuments] delete error:", err);
      toast(`Delete error: ${err.message || err}`, "error");
    }
  }

  async function onDownload(path) {
    try {
      // Generate a signed URL valid for 60 min
      const { data, error } = await supabase.storage
        .from("load_docs")
        .createSignedUrl(path, 60 * 60);

      if (error) throw error;
      const url = data?.signedUrl;
      if (!url) throw new Error("No signed URL returned.");

      // Open in new tab/window
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("[LoadDocuments] download error:", err);
      toast(`Download error: ${err.message || err}`, "error");
    }
  }

  const shown = useMemo(() => {
    if (filterType === "All") return files;
    const norm = normalize(filterType);
    return files.filter((f) => normalize(f.docType) === norm);
  }, [files, filterType]);

  if (!loadId) {
    return (
      <div className={className}>
        <div className="p-4 border rounded-xl bg-[var(--panel)] text-[var(--text-muted)]">
          No load selected.
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5" />
          <h3 className="text-lg font-semibold">Load Documents</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2">
            <span className="text-sm">Doc Type</span>
            <select
              className="px-2 py-1 rounded-md border bg-transparent"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
            >
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>

          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-[var(--bg-hover)] transition disabled:opacity-60"
            title="Upload files"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            <span>Upload</span>
          </button>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_MIME.join(",")}
            onChange={onPickFiles}
            className="hidden"
          />

          <button
            onClick={listAll}
            disabled={busy}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-[var(--bg-hover)] transition disabled:opacity-60"
            title="Refresh"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <Filter className="w-4 h-4" />
          Filter
        </span>
        <select
          className="px-2 py-1 rounded-md border bg-transparent"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option>All</option>
          {DOC_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>

        <span className="ml-auto text-sm text-[var(--text-muted)]">
          {shown.length} file{shown.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* List */}
      <div className="rounded-xl border divide-y overflow-hidden">
        {shown.length === 0 ? (
          <div className="p-6 text-center text-[var(--text-muted)]">
            No documents yet. Click <strong>Upload</strong> to add Rate Cons, PODs, BOLs, etc.
          </div>
        ) : (
          shown.map((f) => <Row key={f.path} file={f} onDownload={onDownload} onDelete={onDelete} />)
        )}
      </div>

      {/* Toast / inline messages */}
      {message && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl border bg-[var(--panel)] shadow">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-sm">{message}</span>
            <button className="ml-2 opacity-70 hover:opacity-100" onClick={() => setMessage("")}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ file, onDownload, onDelete }) {
  const [signing, setSigning] = useState(false);

  const niceName = useMemo(() => {
    // Strip timestamp prefix if present
    const nm = file.name.replace(/^\d{4}-\d{2}-\d{2}T[^_]+__/, "");
    return nm;
  }, [file.name]);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-3">
      <div className="flex items-center gap-3 min-w-0">
        <FileText className="w-5 h-5 shrink-0" />
        <div className="min-w-0">
          <div className="truncate font-medium">{niceName}</div>
          <div className="text-xs text-[var(--text-muted)]">
            Type: <span className="font-medium">{file.docType}</span> • Size: {file.size ? `${bytesToMB(file.size)} MB` : "—"}
          </div>
        </div>
      </div>

      <div className="sm:ml-auto flex items-center gap-2">
        <button
          onClick={() => {
            if (signing) return;
            setSigning(true);
            Promise.resolve(onDownload(file.path)).finally(() => setSigning(false));
          }}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-[var(--bg-hover)] transition disabled:opacity-60"
          disabled={signing}
        >
          {signing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          <span className="text-sm">Open</span>
        </button>

        <button
          onClick={() => onDelete(file.path)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-[var(--bg-hover)] transition text-red-500 hover:text-red-600"
        >
          <Trash2 className="w-4 h-4" />
          <span className="text-sm">Delete</span>
        </button>
      </div>
    </div>
  );
}
