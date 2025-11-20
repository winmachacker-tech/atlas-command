// src/components/ChainControlAlerts.jsx
import { AlertTriangle, Loader2, Link as ChainIcon, Ban, AlertOctagon } from 'lucide-react';
import { getChainControlEmoji, getChainControlAdvice } from '../services/chainControlService';

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

function getChainLevelStyles(chainLevel) {
  switch (chainLevel.code) {
    case 'R3':
      return 'border-red-500/60 bg-red-500/20 text-red-200';
    case 'R2':
      return 'border-amber-500/60 bg-amber-500/20 text-amber-200';
    case 'R1':
      return 'border-yellow-500/60 bg-yellow-500/20 text-yellow-200';
    default:
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200';
  }
}

function getChainLevelIcon(chainLevel) {
  switch (chainLevel.code) {
    case 'R3':
      return <Ban className="h-5 w-5" />;
    case 'R2':
      return <AlertOctagon className="h-5 w-5" />;
    case 'R1':
      return <ChainIcon className="h-5 w-5" />;
    default:
      return null;
  }
}

export default function ChainControlAlerts({ alerts, loading }) {
  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#12151b] p-4">
        <div className="flex items-center gap-2 text-white/60">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Checking mountain passes and chain requirements...</span>
        </div>
      </div>
    );
  }

  if (!alerts || alerts.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="flex items-center gap-2 text-emerald-400">
          <span className="text-lg">✅</span>
          <span className="text-sm font-medium">No chain requirements detected on your route</span>
        </div>
        <p className="text-xs text-emerald-300/70 mt-1 ml-7">
          All mountain passes are clear. Always carry chains in winter conditions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary banner if any R-3 closures */}
      {alerts.some(a => a.chainRequirement.code === 'R3') && (
        <div className="rounded-xl border border-red-500/60 bg-red-500/20 p-4">
          <div className="flex items-start gap-3">
            <Ban className="h-6 w-6 text-red-200 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-red-100 mb-1">
                ⚠️ ROAD CLOSURE ALERT
              </div>
              <p className="text-sm text-red-200">
                One or more mountain passes on your route are CLOSED. You must find an alternate route or wait for conditions to improve.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Individual pass alerts */}
      {alerts.map((alert, idx) => {
        const chainLevel = alert.chainRequirement;
        
        return (
          <div
            key={idx}
            className={cx(
              "rounded-xl border p-4",
              getChainLevelStyles(chainLevel)
            )}
          >
            <div className="flex items-start gap-3">
              {/* Icon and emoji */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-3xl">{getChainControlEmoji(chainLevel)}</span>
                {getChainLevelIcon(chainLevel)}
              </div>

              {/* Alert content */}
              <div className="flex-1 min-w-0">
                {/* Header */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-bold text-base">{alert.passName}</h3>
                      <span className={cx(
                        "text-xs px-2 py-0.5 rounded-full font-bold uppercase tracking-wide",
                        chainLevel.code === 'R3' ? 'bg-red-600/50 text-red-100' :
                        chainLevel.code === 'R2' ? 'bg-amber-600/50 text-amber-100' :
                        'bg-yellow-600/50 text-yellow-100'
                      )}>
                        {chainLevel.code}
                      </span>
                    </div>
                    <div className="text-sm opacity-90 mb-1">
                      {alert.highway} • {alert.description}
                    </div>
                    <div className="text-xs opacity-75">
                      {alert.distanceFromRoute.toFixed(1)} miles from route • Elevation: {alert.elevation.toLocaleString()}ft
                    </div>
                  </div>
                </div>

                {/* Chain requirement label */}
                <div className="bg-black/20 rounded-lg p-3 mb-3">
                  <div className="font-semibold text-sm mb-1">
                    {chainLevel.label}
                  </div>
                  <div className="text-xs opacity-90">
                    {chainLevel.description}
                  </div>
                </div>

                {/* Current conditions */}
                <div className="mb-3">
                  <div className="text-xs font-semibold opacity-75 mb-1">
                    Current Conditions:
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="capitalize">{alert.weather.description}</span>
                    <span>•</span>
                    <span>{alert.weather.temp}°F</span>
                    {alert.weather.windSpeed > 20 && (
                      <>
                        <span>•</span>
                        <span>Winds {alert.weather.windSpeed} mph</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Driver advice */}
                <div className="pt-3 border-t border-current/20">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <p className="text-xs font-medium leading-relaxed">
                      {getChainControlAdvice(chainLevel)}
                    </p>
                  </div>
                </div>

                {/* Additional warnings for R-2 and R-3 */}
                {chainLevel.code === 'R2' && (
                  <div className="mt-2 pt-2 border-t border-current/20">
                    <p className="text-xs opacity-90">
                      ⚠️ <strong>Commercial Vehicle Note:</strong> All commercial vehicles must have chains installed on at least 2 drive axles. Inspect your chains before installation.
                    </p>
                  </div>
                )}
                {chainLevel.code === 'R3' && (
                  <div className="mt-2 pt-2 border-t border-current/20">
                    <p className="text-xs font-bold">
                      🚨 Pass is CLOSED - attempting to proceed is illegal and extremely dangerous. CHP/State Patrol will turn you back.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Footer with chain control info */}
      <div className="text-xs text-white/50 italic bg-slate-950/40 rounded-lg p-3 border border-slate-700/30">
        <div className="font-semibold mb-1">Chain Control Levels Explained:</div>
        <div className="space-y-1 ml-2">
          <div><strong>R-1:</strong> Chains required on drive axle of all commercial vehicles</div>
          <div><strong>R-2:</strong> Chains required on all vehicles except 4WD/AWD with snow tires</div>
          <div><strong>R-3:</strong> Road closed to all traffic - no exceptions</div>
        </div>
        <div className="mt-2 pt-2 border-t border-white/10">
          Always carry chains in winter months and know how to install them. Check state DOT websites for real-time updates.
        </div>
      </div>
    </div>
  );
}