import { useEffect } from "react";
import { Sparkles } from "lucide-react";

export default function AIInsights() {
  useEffect(() => {
    document.title = "Atlas Command | AI Insights";
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-xl bg-emerald-500/15">
          <Sparkles className="w-5 h-5 text-emerald-400" />
        </div>
        <h1 className="text-2xl font-semibold">AI Insights</h1>
      </div>
      <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/60 p-6">
        <p className="text-zinc-300">
          âœ… This route is working! You successfully navigated to /ai-insights
        </p>
        <p className="text-sm text-zinc-400 mt-2">
          Now you can replace this content with your full AI Recommendations component.
        </p>
      </div>
    </div>
  );
}
