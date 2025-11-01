import { useEffect, useState } from "react";
import { Loader2, History, RefreshCw } from "lucide-react";

/**
 * Activity feed placeholder page
 * - Adds a valid route target for "/activity" so React Router stops warning.
 * - You can wire this to Supabase later; for now it renders mock activity safely.
 */
export default function ActivityPage() {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");

  async function fetchActivity() {
    try {
      setLoading(true);
      setErrorMsg("");
      // TODO: replace with your Supabase query
      // const { data, error } = await supabase.from("activity").select("*").order("created_at", { ascending: false }).limit(50);
      // if (error) throw error;
      // setItems(data || []);
      // Temporary mock data to keep the route stable:
      await new Promise((r) => setTimeout(r, 350));
      setItems([
        {
          id: "evt-1",
          type: "load_created",
          message: "Load #AC-10294 created by Danielle",
          created_at: new Date().toISOString(),
        },
        {
          id: "evt-2",
          type: "status_update",
          message: "Load #AC-10021 marked In-Transit",
          created_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
        },
        {
          id: "evt-3",
          type: "pod_uploaded",
          message: "POD uploaded for #AC-09988",
          created_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
        },
      ]);
    } catch (e) {
      setErrorMsg(e.message || "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchActivity();
  }, []);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Activity</h1>
        </div>
        <button
          onClick={fetchActivity}
          className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 rounded-xl border border-zinc-200 p-4 text-sm dark:border-neutral-800">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}

      {!loading && errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {errorMsg}
        </div>
      )}

      {!loading && !errorMsg && items.length === 0 && (
        <div className="rounded-xl border border-zinc-200 p-6 text-sm text-zinc-600 dark:border-neutral-800 dark:text-zinc-300">
          No activity yet.
        </div>
      )}

      {!loading && !errorMsg && items.length > 0 && (
        <ul className="space-y-3">
          {items.map((it) => (
            <li
              key={it.id}
              className="rounded-xl border border-zinc-200 p-4 dark:border-neutral-800"
            >
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm">{it.message}</p>
                <time
                  className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400"
                  dateTime={it.created_at}
                  title={new Date(it.created_at).toLocaleString()}
                >
                  {timeAgo(it.created_at)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function timeAgo(iso) {
  const d = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - d);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
