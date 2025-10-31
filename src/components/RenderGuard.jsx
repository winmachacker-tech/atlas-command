export default function RenderGuard({ loading, error, isEmpty, onRetry, emptyTitle="No data yet", emptyMessage="Once data exists, this will populate.", children }){
  if (loading) return <div className="p-6 rounded-xl border dark:border-neutral-800"><div className="animate-pulse">Loading…</div></div>;
  if (error) return (
    <div className="p-6 rounded-xl border border-red-300/40 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/20">
      <div className="font-medium text-red-700 dark:text-red-200">Error</div>
      <div className="text-sm mt-1 opacity-80">{error}</div>
      {onRetry && <button className="mt-3 rounded-xl border px-3 py-1 text-sm" onClick={onRetry}>Retry</button>}
    </div>
  );
  if (isEmpty) return (
    <div className="p-6 rounded-xl border dark:border-neutral-800">
      <div className="font-medium">{emptyTitle}</div>
      <div className="text-sm opacity-70">{emptyMessage}</div>
    </div>
  );
  return children;
}
