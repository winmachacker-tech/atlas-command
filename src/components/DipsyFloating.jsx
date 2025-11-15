import React, { useState, useRef, useEffect } from 'react';
import { Minimize2, Maximize2, X } from 'lucide-react';
import { DipsyStandalone } from './DipsyStandalone';

const DipsyFloatingWidget = ({ 
  initialState = 'idle',
  onStateChange,
  defaultPosition = { x: window.innerWidth - 120, y: window.innerHeight - 120 },
  onAskDipsy // 🎯 Callback for when user clicks "Ask Dipsy"
}) => {
  const [position, setPosition] = useState(defaultPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [isMinimized, setIsMinimized] = useState(true); // 🎯 Start minimized
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dipsyState, setDipsyState] = useState(initialState);
  const widgetRef = useRef(null);

  // Handle state changes from parent
  useEffect(() => {
    setDipsyState(initialState);
  }, [initialState]);

  // Mouse down - start dragging
  const handleMouseDown = (e) => {
    if (e.target.closest('.control-button')) return; // Don't drag when clicking controls
    
    setIsDragging(true);
    const rect = widgetRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  };

  // Mouse move - update position while dragging
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;

      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;

      // Keep within viewport bounds
      const maxX = window.innerWidth - (isMinimized ? 60 : 200);
      const maxY = window.innerHeight - (isMinimized ? 60 : 200);

      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY))
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, isMinimized]);

  // Toggle minimize
  const toggleMinimize = () => {
    setIsMinimized(!isMinimized);
  };

  return (
    <div
      ref={widgetRef}
      className={`
        fixed z-50
        ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}
        transition-all duration-300 ease-out
        ${isMinimized ? 'w-16 h-16' : 'w-auto'}
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
          {/* Small Dipsy */}
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
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl shadow-2xl border-2 border-slate-700 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-300 rounded-full animate-pulse"></div>
              <span className="text-white font-semibold text-sm">Dipsy</span>
            </div>
            
            <div className="flex gap-1">
              {/* Minimize Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMinimize();
                }}
                className="control-button hover:bg-emerald-500 rounded p-1 transition-colors"
                title="Minimize"
              >
                <Minimize2 className="w-3 h-3 text-white" />
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
            <div className="text-center">
              <p className="text-white text-sm font-medium mb-1">
                {getStatusText(dipsyState)}
              </p>
              <p className="text-slate-400 text-xs">
                {getStatusSubtext(dipsyState)}
              </p>
            </div>

            {/* Action Buttons (optional) */}
            <div className="mt-4 flex gap-2">
              <button 
                onClick={() => {
                  if (onAskDipsy) {
                    onAskDipsy();
                  }
                }}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs py-2 rounded-lg transition-colors font-medium"
              >
                Ask Dipsy
              </button>
            </div>
          </div>

          {/* Drag Handle Indicator */}
          <div className="absolute top-1/2 left-2 -translate-y-1/2 flex flex-col gap-0.5 opacity-30 pointer-events-none">
            <div className="w-1 h-1 bg-white rounded-full"></div>
            <div className="w-1 h-1 bg-white rounded-full"></div>
            <div className="w-1 h-1 bg-white rounded-full"></div>
          </div>
        </div>
      )}

      {/* Dragging indicator */}
      {isDragging && (
        <div className="absolute -inset-2 border-2 border-emerald-400 rounded-2xl pointer-events-none animate-pulse"></div>
      )}
    </div>
  );
};

// Helper functions for status text
const getStatusText = (state) => {
  switch(state) {
    case 'thinking': return 'Analyzing loads...';
    case 'confident-victory': return 'Perfect match found!';
    case 'confident-lightbulb': return 'Great idea!';
    case 'celebrating': return 'Awesome choice!';
    case 'learning': return 'Learning from feedback...';
    default: return 'Ready to help!';
  }
};

const getStatusSubtext = (state) => {
  switch(state) {
    case 'thinking': return 'Checking driver availability';
    case 'confident-victory': return 'High confidence recommendation';
    case 'confident-lightbulb': return 'Smart suggestion detected';
    case 'celebrating': return 'Thanks for the feedback!';
    case 'learning': return 'Improving recommendations';
    default: return 'Drag me anywhere you like';
  }
};

// Demo component showing the widget in action
const DipsyFloatingDemo = () => {
  const [currentState, setCurrentState] = useState('idle');

  // Auto-cycle states for demo
  useEffect(() => {
    const states = ['idle', 'thinking', 'confident-victory', 'confident-lightbulb', 'celebrating', 'learning'];
    let index = 0;
    const interval = setInterval(() => {
      index = (index + 1) % states.length;
      setCurrentState(states[index]);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative w-full h-screen bg-slate-900">
      {/* Demo Content */}
      <div className="p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold text-white mb-4">
            Draggable Dipsy Widget Demo
          </h1>
          <div className="bg-slate-800 rounded-xl p-6 mb-6">
            <h2 className="text-xl font-semibold text-white mb-3">Features:</h2>
            <ul className="space-y-2 text-slate-300">
              <li className="flex items-start gap-2">
                <span className="text-emerald-400">✓</span>
                <span><strong>Draggable:</strong> Click and drag Dipsy anywhere on screen</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400">✓</span>
                <span><strong>Minimizable:</strong> Collapse to small icon when not needed</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400">✓</span>
                <span><strong>Boundary Detection:</strong> Stays within viewport</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400">✓</span>
                <span><strong>Smooth Animations:</strong> Transitions between all states</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400">✓</span>
                <span><strong>Status Updates:</strong> Shows what Dipsy is doing</span>
              </li>
            </ul>
          </div>

          <div className="bg-slate-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">Current State:</h2>
            <p className="text-emerald-400 text-lg font-mono">{currentState}</p>
            
            <div className="mt-4 flex flex-wrap gap-2">
              {['idle', 'thinking', 'confident-victory', 'confident-lightbulb', 'celebrating', 'learning'].map(state => (
                <button
                  key={state}
                  onClick={() => setCurrentState(state)}
                  className={`
                    px-3 py-1 rounded text-xs font-medium transition-all
                    ${currentState === state 
                      ? 'bg-emerald-600 text-white' 
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }
                  `}
                >
                  {state.replace('-', ' ')}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 bg-slate-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">Usage in Atlas Command:</h2>
            <div className="bg-slate-900 p-4 rounded-lg">
              <code className="text-sm text-cyan-300">
                {`// Import the floating widget
import { DipsyFloatingWidget } from './dipsy-floating';

// In your app
const [dipsyState, setDipsyState] = useState('idle');

// Update state based on actions
const handleLoadAnalysis = () => {
  setDipsyState('thinking');
  // ... after analysis
  setDipsyState('confident-victory');
};

// Render
<DipsyFloatingWidget 
  initialState={dipsyState}
  defaultPosition={{ x: 100, y: 100 }}
/>`}
              </code>
            </div>
          </div>
        </div>
      </div>

      {/* The Floating Dipsy Widget */}
      <DipsyFloatingWidget 
        initialState={currentState}
        defaultPosition={{ x: window.innerWidth - 250, y: 100 }}
      />
    </div>
  );
};

export default DipsyFloatingDemo;
export { DipsyFloatingWidget };