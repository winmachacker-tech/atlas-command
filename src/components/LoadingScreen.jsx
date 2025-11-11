export default function LoadingScreen({ label = "Loadingâ€¦" }) {
  return (
    <div className="min-h-screen grid place-items-center bg-neutral-950 text-neutral-200">
      <div className="rounded-2xl border border-neutral-800 px-6 py-4">
        <div className="animate-pulse">{label}</div>
      </div>
    </div>
  );
}

