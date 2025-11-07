import { useState } from "react";
import { supabase } from "../lib/supabase";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { trackLogin, trackFailedLogin } from "../lib/activityTracker"; // ✅ NEW

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const location = useLocation();
  
  // ✅ Get redirect from query params (not location state)
  const params = new URLSearchParams(location.search);
  const redirectTo = params.get("redirect") || location.state?.from?.pathname || "/";

  async function onLogin(e) {
    e.preventDefault();
    try {
      setBusy(true);
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      
      // ✅ Track successful login
      trackLogin().catch(err => console.error("Failed to track login:", err));
      
      nav(redirectTo, { replace: true });
    } catch (err) {
      // ✅ Track failed login
      trackFailedLogin(err.message).catch(e => console.error("Failed to track failed login:", e));
      
      alert(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      {/* 🔷 Background */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage:
            "url('/575e3959-3cc9-4263-9cde-6cfa0477cb81.png')",
          backgroundSize: "cover",
          filter: "brightness(0.6)",
        }}
      ></div>

      {/* 🔷 Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-black/70"></div>

      {/* 🔷 Login Card */}
      <div className="relative z-10 flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/10 backdrop-blur-xl p-8 shadow-2xl">
          <h1 className="text-2xl font-semibold text-white mb-1 text-center">
            Welcome back
          </h1>
          <p className="text-sm text-gray-300 mb-6 text-center">
            Sign in to Atlas Command
          </p>

          <form onSubmit={onLogin} className="space-y-4">
            <div>
              <label className="text-sm block mb-1 text-gray-200">Email</label>
              <input
                className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="text-sm block mb-1 text-gray-200">Password</label>
              <input
                className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button
              disabled={busy}
              className="w-full mt-4 rounded-xl bg-blue-600 hover:bg-blue-700 py-2 font-medium text-white shadow transition-colors disabled:opacity-70"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="text-sm mt-6 text-center text-gray-300">
            No account?{" "}
            <Link to="/signup" className="underline text-blue-400">
              Create one
            </Link>
          </div>

          <p className="text-xs text-center text-gray-400 mt-8">
            © {new Date().getFullYear()} Atlas Command Systems
          </p>
        </div>
      </div>
    </div>
  );
}