// src/components/RechartSafeContainer.jsx
import { useEffect, useRef, useState } from "react";

/**
 * Ensures Recharts children only render when the container has a non-zero width/height.
 * Fixes: "The width(-1) and height(-1) of chart should be greater than 0" warnings.
 */
export default function RechartSafeContainer({ className = "h-64 w-full", children }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = el;
      setReady(clientWidth > 0 && clientHeight > 0);
    });
    ro.observe(el);
    // initial measure
    const { clientWidth, clientHeight } = el;
    setReady(clientWidth > 0 && clientHeight > 0);

    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className={["min-h-[16rem]", className].join(" ")}>
      {ready ? (
        children
      ) : (
        <div className="h-full w-full animate-pulse rounded-xl bg-zinc-100 dark:bg-neutral-900" />
      )}
    </div>
  );
}
// Ready for the next step?

