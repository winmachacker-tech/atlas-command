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
  Scan,
  Eye,
} from "lucide-react";

/**
 * LoadDocuments with OCR
 * --------------------------------------------------------------------------
 * Enhanced version with manual OCR text extraction
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
  const [ocrResults, setOcrResults] = useState({}); // Store OCR results by file path
  const inputRef = useRef(null);

  const prefix = useMemo(() => {
    if (!loadId) return null;
    return `${loadId}/`;
  }, [loadId]);

  async function listAll() {
    if (!prefix) return;
    setBusy(true);
    try {
      const { data: typeDirs, error: listErr } = await supabase.storage
        .from("load_docs")
        .list(prefix, { limit: 100, offset: 0 });

      if (listErr) throw listErr;

      let all = [];
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
    const parts = path.split("/");
    const maybeType = parts[1] || "Other";
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
    e.target.value = "";
  }

  async function doUpload(fileList) {
    if (!prefix) return;
    setUploading(true);
    try {
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
      // Clear OCR results for this file
      setOcrResults((prev) => {
        const newResults = { ...prev };
        delete newResults[path];
        return newResults;
      });
    } catch (err) {
      console.error("[LoadDocuments] delete error:", err);
      toast(`Delete error: ${err.message || err}`, "error");
    }
  }

  async function onDownload(path) {
    try {
      const { data, error } = await supabase.storage
        .from("load_docs")
        .createSignedUrl(path, 60 * 60);

      if (error) throw error;
      const url = data?.signedUrl;
      if (!url) throw new Error("No signed URL returned.");

      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("[LoadDocuments] download error:", err);
      toast(`Download error: ${err.message || err}`, "error");
    }
  }

  async function onExtractText(file) {
    try {
      // Mark as processing
      setOcrResults((prev) => ({
        ...prev,
        [file.path]: { processing: true },
      }));

      // Download the file from storage
      const { data: blob, error: downloadErr } = await supabase.storage
        .from("load_docs")
        .download(file.path);

      if (downloadErr) throw downloadErr;

      // Convert blob to File object
      const fileObj = new File([blob], file.name, { type: blob.type });

      // Send to OCR API
      const formData = new FormData();
      formData.append("file", fileObj);
      formData.append("documentType", mapDocTypeToOCR(file.docType));

      // Auto-detect: use local server in dev, Vercel function in prod
      const apiUrl = import.meta.env.DEV 
        ? "http://localhost:3001/api/ocr" 
        : "/api/ocr";
      
      const response = await fetch(apiUrl, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("OCR processing failed");
      }

      const data = await response.json();

      // Save to database
      const { error: dbError } = await supabase
        .from("document_ocr_results")
        .insert({
          load_id: loadId,
          file_path: file.path,
          file_name: file.name,
          document_type: mapDocTypeToOCR(file.docType),
          full_text: data.data.fullText,
          confidence: data.data.confidence,
          detected_language: data.data.detectedLanguage,
          structured_data: data.data.structuredData,
          file_size: file.size,
          mime_type: blob.type,
        });

      if (dbError) {
        console.error("[LoadDocuments] DB save error:", dbError);
        toast("Text extracted but failed to save to database", "error");
      }

      // Store results in state
      setOcrResults((prev) => ({
        ...prev,
        [file.path]: {
          processing: false,
          success: true,
          data: data.data,
          saved: !dbError,
        },
      }));

      toast("Text extracted and saved!", "success");
    } catch (err) {
      console.error("[LoadDocuments] OCR error:", err);
      setOcrResults((prev) => ({
        ...prev,
        [file.path]: {
          processing: false,
          success: false,
          error: err.message,
        },
      }));
      toast(`OCR failed: ${err.message}`, "error");
    }
  }

  function mapDocTypeToOCR(docType) {
    const mapping = {
      "Rate Con": "RATE_CONFIRMATION",
      "POD": "POD",
      "BOL": "BOL",
      "Invoice": "INVOICE",
      "Photos": "UNKNOWN",
      "Other": "UNKNOWN",
    };
    return mapping[docType] || "UNKNOWN";
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
          shown.map((f) => (
            <Row
              key={f.path}
              file={f}
              onDownload={onDownload}
              onDelete={onDelete}
              onExtractText={onExtractText}
              ocrResult={ocrResults[f.path]}
            />
          ))
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

function Row({ file, onDownload, onDelete, onExtractText, ocrResult }) {
  const [signing, setSigning] = useState(false);
  const [showOCR, setShowOCR] = useState(false);

  const niceName = useMemo(() => {
    const nm = file.name.replace(/^\d{4}-\d{2}-\d{2}T[^_]+__/, "");
    return nm;
  }, [file.name]);

  const canOCR = useMemo(() => {
    // Only allow OCR for images and PDFs
    const ocrTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    return file.name.match(/\.(pdf|jpe?g|png|webp)$/i);
  }, [file.name]);

  return (
    <div className="p-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <FileText className="w-5 h-5 shrink-0" />
          <div className="min-w-0">
            <div className="truncate font-medium">{niceName}</div>
            <div className="text-xs text-[var(--text-muted)]">
              Type: <span className="font-medium">{file.docType}</span> â€¢ Size: {file.size ? `${bytesToMB(file.size)} MB` : "â€”"}
            </div>
          </div>
        </div>

        <div className="sm:ml-auto flex items-center gap-2">
          {canOCR && (
            <button
              onClick={() => onExtractText(file)}
              disabled={ocrResult?.processing}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-[var(--bg-hover)] transition disabled:opacity-60"
              title="Extract text with OCR"
            >
              {ocrResult?.processing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Scan className="w-4 h-4" />
              )}
              <span className="text-sm">Extract Text</span>
            </button>
          )}

          {ocrResult?.success && (
            <button
              onClick={() => setShowOCR(!showOCR)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-[var(--bg-hover)] transition text-emerald-500"
              title="View extracted text"
            >
              <Eye className="w-4 h-4" />
              <span className="text-sm">View Text</span>
            </button>
          )}

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

      {/* OCR Results Panel */}
      {showOCR && ocrResult?.success && (
        <div className="mt-3 p-4 rounded-lg border bg-[var(--panel)]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold">Extracted Text</h4>
            <span className="text-xs text-emerald-500">
              {(ocrResult.data.confidence * 100).toFixed(1)}% confidence
            </span>
          </div>

          {/* Structured Data */}
          {ocrResult.data.structuredData && (
            <div className="mb-3 p-3 rounded bg-white/5">
              <div className="text-sm font-medium mb-2">Extracted Fields:</div>
              <div className="space-y-1 text-sm">
                {Object.entries(ocrResult.data.structuredData).map(([key, value]) => {
                  if (key === 'rawText' || key === 'fullText' || !value) return null;
                  return (
                    <div key={key} className="flex">
                      <span className="text-[var(--text-muted)] min-w-[120px]">
                        {key.replace(/([A-Z])/g, ' $1').trim()}:
                      </span>
                      <span className="font-medium">
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Full Text */}
          <div className="max-h-64 overflow-y-auto p-3 rounded bg-white/5 text-sm font-mono whitespace-pre-wrap">
            {ocrResult.data.fullText}
          </div>
        </div>
      )}

      {/* Error */}
      {ocrResult?.error && (
        <div className="mt-3 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-300">
          OCR Error: {ocrResult.error}
        </div>
      )}
    </div>
  );
}
