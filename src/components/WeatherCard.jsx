// src/components/WeatherCard.jsx
import { useEffect, useState } from "react";
import { 
  Cloud, 
  CloudRain, 
  Wind, 
  Droplets, 
  AlertTriangle,
  Loader2 
} from "lucide-react";
import {
  getWeatherByCity,
  getWeatherEmoji,
  getWindDirection,
  isSevereWeather,
} from "../services/weatherService";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

export default function WeatherCard({ city, state, label = "Weather" }) {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!city || !state) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    async function fetchWeather() {
      setLoading(true);
      setError(null);

      try {
        const data = await getWeatherByCity(city, state);
        
        if (!isMounted) return;
        
        if (data) {
          setWeather(data);
        } else {
          setError("Weather unavailable");
        }
      } catch (err) {
        if (!isMounted) return;
        setError("Failed to load weather");
        console.error(err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchWeather();

    return () => {
      isMounted = false;
    };
  }, [city, state]);

  if (!city || !state) {
    return null;
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#12151b] p-4">
        <div className="flex items-center gap-2 text-white/60">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading weather...</span>
        </div>
      </div>
    );
  }

  if (error || !weather) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#12151b] p-4">
        <div className="flex items-center gap-2 text-white/40">
          <Cloud className="h-4 w-4" />
          <span className="text-sm">{error || "Weather unavailable"}</span>
        </div>
      </div>
    );
  }

  const severe = isSevereWeather(weather);

  return (
    <div className={cx(
      "rounded-xl border p-4 transition",
      severe 
        ? "border-amber-500/40 bg-amber-500/10" 
        : "border-white/10 bg-[#12151b]"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {severe && <AlertTriangle className="h-4 w-4 text-amber-400" />}
          <span className="text-sm font-medium text-white/70">{label}</span>
        </div>
        <span className="text-2xl">{getWeatherEmoji(weather.condition)}</span>
      </div>

      {/* Temperature & Condition */}
      <div className="mb-3">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold">{weather.temp}°F</span>
          <span className="text-sm text-white/60">
            Feels like {weather.feelsLike}°
          </span>
        </div>
        <p className="text-sm text-white/70 capitalize mt-1">
          {weather.description}
        </p>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2">
          <Wind className="h-4 w-4 text-white/50" />
          <div>
            <p className="text-xs text-white/50">Wind</p>
            <p className="text-sm font-medium">
              {weather.windSpeed} mph {getWindDirection(weather.windDirection)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Droplets className="h-4 w-4 text-white/50" />
          <div>
            <p className="text-xs text-white/50">Humidity</p>
            <p className="text-sm font-medium">{weather.humidity}%</p>
          </div>
        </div>
      </div>

      {/* Severe Weather Warning */}
      {severe && (
        <div className="mt-3 pt-3 border-t border-amber-500/20">
          <p className="text-xs text-amber-300 font-medium">
            ⚠️ Severe weather conditions may affect delivery
          </p>
        </div>
      )}
    </div>
  );
}