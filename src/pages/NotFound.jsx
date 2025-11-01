// src/pages/NotFound.jsx
import { Link, useLocation } from "react-router-dom";

export default function NotFound() {
  const { pathname } = useLocation();
  return (
    <section className="max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="opacity-70">
        No route matched <code className="px-1 py-0.5 rounded bg-black/5 dark:bg-white/10">{pathname}</code>.
      </p>
      <div className="flex gap-3">
        <Link
          to="/dashboard"
          className="rounded-xl px-3 py-2 bg-black text-white dark:bg-white dark:text-black"
        >
          Go to Dashboard
        </Link>
        <Link to="/loads" className="underline">View Loads</Link>
      </div>
    </section>
  );
}
