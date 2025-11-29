import React, { useState, useRef, useEffect } from "react";
import { Minimize2, Mic, MicOff } from "lucide-react";
import { DipsyStandalone } from "./DipsyStandalone";
import { useDipsyVoiceClient } from "../hooks/useDipsyVoiceClient";

// Floating Dipsy widget with built-in voice controls.
//
// What this file does (plain English):
// - Shows the little draggable Dipsy bubble (minimized).
// - When you click it, it expands into the full mini-panel.
// - Adds a MIC button in the header that uses the shared voice hook:
//     • startListening() when you click to talk
//     • stopListening() when you click again
// - Shows simple voice status: "Voice ready", "Listening…", "Speaking…", etc.
// - Shows the latest Dipsy spoken reply text under the face.
// - Keeps your existing "Ask Dipsy" button that opens the full chat panel.
//
// This does NOT touch any Supabase auth / RLS / security. It only talks to
// your voice WebSocket URL from VITE_DIPSY_VOICE_WS_URL (frontend-safe).

const DipsyFloatingWidget = ({
  initialState = "idle",
  onStateChange,
  defaultPosition = {
    x: window.innerWidth - 120,
    y: window.innerHeight - 120,
  },
  onAskDipsy, // callback for full panel open
}) => {
  const [position, setPosition] = useState(defaultPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [isMinimized, setIsMinimized] = useState(true); // start minimized
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dipsyState, setDipsyState] = useState(initialState);
  const widgetRef = useRef(null);

  // 🔊 Voice hook: browser <-> voice server
  const {
    isSupported,
    isConnected,
    isListening,
    isSpeaking,
    lastTranscript,
    error,
    startListening,
    stopListening,
    playScript,
    reloadBrain,
  } = useDipsyVoiceClient();

  // Keep local Dipsy animation state in sync with parent,
  // but if she's actively speaking we force a "confident" pose.
  useEffect(() => {
    if (isSpeaking) {
      setDipsyState("confident-lightbulb");
    } else {
      setDipsyState(initialState);
    }
  }, [initialState, isSpeaking]);

  // Mouse down - start dragging (but not when clicking controls)
  const handleMouseDown = (e) => {
    if (e.target.closest(".control-button")) return;

    setIsDragging(true);
    const rect = widgetRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  // Mouse move - update position while dragging
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;

      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;

      const maxX = window.innerWidth - (isMinimized ? 60 : 260);
      const maxY = window.innerHeight - (isMinimized ? 60 : 260);

      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset, isMinimized]);

  // Toggle minimize
  const toggleMinimize = () => {
    setIsMinimized((prev) => !prev);
  };

  // Handle mic click: start/stop listening
  const handleMicClick = (e) => {
    e.stopPropagation();
    if (!isSupported) return;

    if (!isListening) {
      startListening();
    } else {
      stopListening();
    }
  };

  // Simple text for voice status pill
  const getVoiceStatusLabel = () => {
    if (!isSupported) return "Voice unavailable";
    if (error) return "Voice error";
    if (isListening) return "Listening…";
    if (isSpeaking) return "Speaking…";
    if (isConnected) return "Voice ready";
    return "Connecting…";
  };

  const getVoiceStatusColor = () => {
    if (error) return "bg-red-600";
    if (!isSupported) return "bg-slate-600";
    if (isListening) return "bg-pink-600";
    if (isSpeaking) return "bg-indigo-600";
    if (isConnected) return "bg-emerald-600";
    return "bg-slate-600";
  };

  return (
    <div
      ref={widgetRef}
      className={`
        fixed z-50
        ${isDragging ? "cursor-grabbing" : "cursor-grab"}
        transition-all duration-300 ease-out
        ${isMinimized ? "w-16 h-16" : "w-auto"}
      `}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Minimized State - Just small Dipsy */}
      {isMinimized ? (
        <div
          className="relative group cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            toggleMinimize();
          }}
        >
          <div className="hover:scale-110 transition-transform">
            <DipsyStandalone state={dipsyState} size="small" />
          </div>

          {/* Hover tooltip */}
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <div className="bg-slate-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
              Click to expand Dipsy
            </div>
          </div>
        </div>
      ) : (
        /* Expanded State - Full Widget */
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl shadow-2xl border border-slate-700/80 overflow-hidden min-w-[260px]">
          {/* Header */}
          <div className="bg-slate-900/80 px-4 py-2 flex items-center justify-between border-b border-slate-700/70">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-white font-semibold text-sm">Dipsy</span>

              {/* Voice status pill */}
              <span
                className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-white ${getVoiceStatusColor()}`}
              >
                {getVoiceStatusLabel()}
              </span>
            </div>

            <div className="flex items-center gap-1">
              {/* Mic button */}
              <button
                className={`
                  control-button rounded-full p-1.5 transition-colors border border-slate-600
                  ${
                    isListening
                      ? "bg-pink-600 hover:bg-pink-500"
                      : "bg-slate-800 hover:bg-slate-700"
                  }
                `}
                onClick={handleMicClick}
                title={
                  !isSupported
                    ? "Voice not supported in this browser"
                    : isListening
                    ? "Stop listening"
                    : "Talk to Dipsy"
                }
              >
                {isListening ? (
                  <MicOff className="w-3.5 h-3.5 text-white" />
                ) : (
                  <Mic className="w-3.5 h-3.5 text-pink-300" />
                )}
              </button>

              {/* Minimize Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMinimize();
                }}
                className="control-button hover:bg-slate-800 rounded-full p-1.5 transition-colors"
                title="Minimize"
              >
                <Minimize2 className="w-3.5 h-3.5 text-slate-200" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-4">
            {/* Dipsy Character */}
            <div className="flex justify-center mb-3">
              <DipsyStandalone state={dipsyState} size="large" />
            </div>

            {/* Status Text */}
            <div className="text-center mb-3">
              <p className="text-white text-sm font-medium mb-1">
                {getStatusText(dipsyState)}
              </p>
              <p className="text-slate-400 text-xs">
                {getStatusSubtext(dipsyState)}
              </p>
            </div>

            {/* Latest voice reply (if any) */}
            {lastTranscript && (
              <div className="mb-3 rounded-lg bg-slate-900/80 border border-slate-700/70 px-3 py-2 text-xs text-slate-200 text-left">
                <span className="font-semibold text-emerald-300">Dipsy: </span>
                <span>{lastTranscript}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="mt-2 flex flex-col gap-2">
              <button
                onClick={() => {
                  if (onAskDipsy) {
                    onAskDipsy();
                  }
                }}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs py-2 rounded-lg transition-colors font-medium"
              >
                Ask Dipsy
              </button>
            </div>

            {/* Voice error message (if any) */}
            {error && (
              <p className="mt-2 text-[11px] text-red-400 text-center">
                {error}
              </p>
            )}
          </div>

          {/* Drag Handle Indicator */}
          <div className="absolute top-1/2 left-2 -translate-y-1/2 flex flex-col gap-0.5 opacity-30 pointer-events-none">
            <div className="w-1 h-1 bg-white rounded-full" />
            <div className="w-1 h-1 bg-white rounded-full" />
            <div className="w-1 h-1 bg-white rounded-full" />
          </div>
        </div>
      )}

      {/* Dragging indicator */}
      {isDragging && (
        <div className="absolute -inset-2 border-2 border-emerald-400 rounded-2xl pointer-events-none animate-pulse" />
      )}
    </div>
  );
};

// Helper functions for status text
const getStatusText = (state) => {
  switch (state) {
    case "thinking":
      return "Analyzing loads...";
    case "confident-victory":
      return "Perfect match found!";
    case "confident-lightbulb":
      return "Great idea!";
    case "celebrating":
      return "Awesome choice!";
    case "learning":
      return "Learning from feedback...";
    default:
      return "Ready to help!";
  }
};

const getStatusSubtext = (state) => {
  switch (state) {
    case "thinking":
      return "Checking driver availability";
    case "confident-victory":
      return "High confidence recommendation";
    case "confident-lightbulb":
      return "Smart suggestion detected";
    case "celebrating":
      return "Thanks for the feedback!";
    case "learning":
      return "Improving recommendations";
    default:
      return "Drag me anywhere you like";
  }
};

export { DipsyFloatingWidget };
export default DipsyFloatingWidget;
