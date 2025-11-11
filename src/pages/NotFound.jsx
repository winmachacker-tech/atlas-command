import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="min-h-[50vh] grid place-items-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-bold">Page not found</h1>
        <p className="mt-2 text-zinc-500">No route matched this URL.</p>
        <div className="mt-6 flex items-center justify-center gap-4">
          <Link to="/dashboard" className="rounded-xl border px-4 py-2">
            Go to Dashboard
          </Link>
          <Link to="/loads" className="underline">View Loads</Link>
        </div>
      </div>
    </div>
  );
}

