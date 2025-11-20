// src/components/RouteWeatherAlerts.jsx
import { AlertTriangle, Wind, CloudSnow, CloudRain, Loader2 } from 'lucide-react';

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function getSeverityStyles(severity) {
  switch (severity) {
    case 'critical':
      return 'border-red-500/40 bg-red-500/10 text-red-300';
    case 'high':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
    case 'moderate':
      return 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300';
    default:
      return 'border-white/10 bg-white/5 text-white/80';
  }
}

function getSeverityIcon(condition) {
  switch (condition) {
    case 'Snow':
      return <CloudSnow className="h-4 w-4" />;
    case 'Rain':
    case 'Thunderstorm':
      return <CloudRain className="h-4 w-4" />;
    case 'Wind':
      return <Wind className="h-4 w-4" />;
    default:
      return <AlertTriangle className="h-4 w-4" />;
  }
}

export default function RouteWeatherAlerts({ alerts, loading }) {
  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#12151b] p-4">
        <div className="flex items-center gap-2 text-white/60">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Checking weather along route...</span>
        </div>
      </div>
    );
  }

  if (!alerts || alerts.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="flex items-center gap-2 text-emerald-400">
          <span className="text-lg">✅</span>
          <span className="text-sm font-medium">Clear weather conditions along your route</span>
        </div>
        <p className="text-xs text-emerald-300/70 mt-1 ml-7">
          No severe weather detected at pickup, delivery, or en route stops.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert, idx) => (
        <div
          key={idx}
          className={cx(
            "rounded-xl border p-4",
            getSeverityStyles(alert.severity)
          )}
        >
          <div className="flex items-start gap-3">
            {/* Icon and emoji */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-2xl">{alert.icon}</span>
              {getSeverityIcon(alert.condition)}
            </div>

            {/* Alert content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="font-medium text-sm">{alert.location}</span>
                {alert.city && alert.city !== alert.location && (
                  <span className="text-xs opacity-70">({alert.city})</span>
                )}
                <span className={cx(
                  "text-xs px-2 py-0.5 rounded-full font-medium uppercase tracking-wide",
                  alert.severity === 'critical' ? 'bg-red-500/30 text-red-200' :
                  alert.severity === 'high' ? 'bg-amber-500/30 text-amber-200' :
                  'bg-yellow-500/30 text-yellow-200'
                )}>
                  {alert.severity}
                </span>
              </div>

              <p className="text-sm capitalize mb-2">
                {alert.description}
              </p>

              <div className="flex items-center gap-4 text-xs opacity-80">
                <span>{alert.temp}°F</span>
                {alert.windSpeed > 25 && (
                  <span className="flex items-center gap-1">
                    <Wind className="h-3 w-3" />
                    {alert.windSpeed} mph winds
                  </span>
                )}
              </div>

              {/* Warning message based on severity */}
              {alert.severity === 'critical' && (
                <div className="mt-3 pt-3 border-t border-current/20">
                  <p className="text-xs font-medium">
                    ⚠️ Extreme weather - consider delaying travel or finding alternate route
                  </p>
                </div>
              )}
              {alert.severity === 'high' && (
                <div className="mt-3 pt-3 border-t border-current/20">
                  <p className="text-xs font-medium">
                    ⚠️ Severe conditions - drive with extreme caution
                  </p>
                </div>
              )}
              {alert.severity === 'moderate' && (
                <div className="mt-3 pt-3 border-t border-current/20">
                  <p className="text-xs font-medium">
                    ⚠️ Hazardous conditions - reduce speed and increase following distance
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Summary footer */}
      <div className="text-xs text-white/60 italic">
        Weather data updated in real-time from OpenWeatherMap. Conditions may change rapidly.
      </div>
    </div>
  );
}