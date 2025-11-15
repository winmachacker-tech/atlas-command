import React, { useState, useEffect } from 'react';
import { Brain, Sparkles, ThumbsUp, BookOpen } from 'lucide-react';

const DipsyStandalone = ({ state = 'idle', size = 'medium' }) => {
  // Size configurations
  const sizes = {
    small: {
      container: 'w-8 h-8',
      eye: 'w-2 h-2',
      pupil: 'w-1 h-1',
      highlight: 'w-0.5 h-0.5',
      smile: 'w-3 h-1',
      particle: 'w-0.5 h-0.5',
      icon: 'w-2 h-2',
      lightbulb: 'w-4 h-5',
      arm: 'w-0.5 h-2',
      eyebrow: 'w-2 h-0.5',
      mouth: 'w-3'
    },
    medium: {
      container: 'w-12 h-12',
      eye: 'w-3 h-3',
      pupil: 'w-1.5 h-1.5',
      highlight: 'w-1 h-1',
      smile: 'w-4 h-1.5',
      particle: 'w-1 h-1',
      icon: 'w-3 h-3',
      lightbulb: 'w-5 h-6',
      arm: 'w-1 h-3',
      eyebrow: 'w-3 h-0.5',
      mouth: 'w-5'
    },
    large: {
      container: 'w-20 h-20',
      eye: 'w-5 h-5',
      pupil: 'w-2.5 h-2.5',
      highlight: 'w-1.5 h-1.5',
      smile: 'w-6 h-2',
      particle: 'w-1.5 h-1.5',
      icon: 'w-4 h-4',
      lightbulb: 'w-7 h-8',
      arm: 'w-1.5 h-4',
      eyebrow: 'w-5 h-1',
      mouth: 'w-8'
    }
  };

  const s = sizes[size];

  const getStateStyles = () => {
    switch(state) {
      case 'sleeping':
        return {
          bgGlow: 'shadow-[0_0_15px_rgba(6,182,212,0.2)]',
          eyePosition: '',
          pupilPosition: 'top-1 left-1',
          eyeScale: 'scale-y-20',
          pulseSpeed: 'animate-pulse-sleeping',
          borderColor: 'border-cyan-400/50',
          icon: null,
          extraElement: (
            <>
              <div className="absolute -top-6 -right-2 animate-float-z1">
                <span className="text-cyan-400 text-xs opacity-60">z</span>
              </div>
              <div className="absolute -top-10 -right-1 animate-float-z2">
                <span className="text-cyan-400 text-sm opacity-40">Z</span>
              </div>
            </>
          ),
          eyebrowLeft: '-top-0.5 -left-0.5 opacity-50',
          eyebrowRight: '-top-0.5 -right-0.5 opacity-50',
          mouthShape: 'sleeping',
          headTilt: 'rotate-3',
          blinkSpeed: 'animate-blink-sleeping'
        };
      case 'thinking':
        return {
          bgGlow: 'shadow-[0_0_30px_rgba(6,182,212,0.6)]',
          eyePosition: '',
          pupilPosition: 'animate-pupil-dart',
          eyeScale: 'scale-100',
          pulseSpeed: 'animate-pulse-fast',
          borderColor: 'border-cyan-400',
          icon: <Brain className={`${s.icon} text-cyan-300 animate-spin`} />,
          extraElement: null,
          eyebrowLeft: '-top-1 -left-0.5 -rotate-12 animate-brow-focus-left',
          eyebrowRight: '-top-1 -right-0.5 rotate-12 animate-brow-focus-right',
          mouthShape: 'concentrated',
          headTilt: 'rotate-2',
          blinkSpeed: 'animate-blink-fast'
        };
      case 'confident-victory':
        return {
          bgGlow: 'shadow-[0_0_40px_rgba(34,197,94,0.8)]',
          eyePosition: '',
          pupilPosition: '',
          eyeScale: 'scale-y-50 animate-eyes-squint',
          pulseSpeed: 'animate-victory-jump',
          borderColor: 'border-green-400',
          icon: null,
          extraElement: (
            <>
              <div className={`absolute -left-2 top-1 ${s.arm} bg-green-400 rounded-full animate-arm-left origin-bottom`}></div>
              <div className={`absolute -right-2 top-1 ${s.arm} bg-green-400 rounded-full animate-arm-right origin-bottom`}></div>
              <div className="absolute -top-2 left-1/2 -translate-x-1/2">
                <Sparkles className={`${s.icon} text-yellow-300 animate-sparkle-burst`} />
              </div>
              <div className={`absolute top-0 -left-3 w-2 h-2 bg-yellow-300 rounded-full animate-star-burst-1`}></div>
              <div className={`absolute top-0 -right-3 w-2 h-2 bg-green-300 rounded-full animate-star-burst-2`}></div>
            </>
          ),
          eyebrowLeft: '-top-2 -left-1 rotate-12 animate-brow-excited-left',
          eyebrowRight: '-top-2 -right-1 -rotate-12 animate-brow-excited-right',
          mouthShape: 'open-happy',
          headTilt: 'animate-head-shake-happy',
          blinkSpeed: 'animate-blink-excited'
        };
      case 'confident-lightbulb':
        return {
          bgGlow: 'shadow-[0_0_40px_rgba(34,197,94,0.8)]',
          eyePosition: '',
          pupilPosition: 'top-0 left-1/2 -translate-x-1/2',
          eyeScale: 'scale-125 animate-eyes-wide-pop',
          pulseSpeed: 'animate-bounce-subtle',
          borderColor: 'border-green-400',
          icon: null,
          extraElement: (
            <>
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 animate-lightbulb-appear">
                <div className="relative">
                  <div className="absolute inset-0 bg-yellow-300 rounded-full blur-md animate-pulse-glow"></div>
                  <div className={`relative ${s.lightbulb} bg-gradient-to-b from-yellow-200 to-yellow-400 rounded-t-full`}>
                    <div className="absolute top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-white rounded-full opacity-80"></div>
                  </div>
                  <div className="w-3 h-2 bg-slate-700 mx-auto rounded-sm"></div>
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                    <div className="absolute w-8 h-0.5 bg-yellow-300 opacity-60 animate-ray-1"></div>
                    <div className="absolute w-8 h-0.5 bg-yellow-300 opacity-60 animate-ray-2 rotate-45"></div>
                    <div className="absolute w-8 h-0.5 bg-yellow-300 opacity-60 animate-ray-3 rotate-90"></div>
                    <div className="absolute w-8 h-0.5 bg-yellow-300 opacity-60 animate-ray-4 -rotate-45"></div>
                  </div>
                </div>
              </div>
              <div className="absolute inset-0 bg-yellow-200 rounded-lg animate-flash-once"></div>
            </>
          ),
          eyebrowLeft: '-top-3 -left-1 rotate-45 animate-brow-raise-left',
          eyebrowRight: '-top-3 -right-1 -rotate-45 animate-brow-raise-right',
          mouthShape: 'surprised',
          headTilt: 'animate-head-tilt-curious',
          blinkSpeed: 'animate-blink-surprised'
        };
      case 'celebrating':
        return {
          bgGlow: 'shadow-[0_0_40px_rgba(34,197,94,0.8)]',
          eyePosition: '',
          pupilPosition: 'animate-pupil-dance',
          eyeScale: 'scale-110',
          pulseSpeed: 'animate-bounce',
          borderColor: 'border-green-400',
          icon: <ThumbsUp className={`${s.icon} text-green-300 animate-bounce`} />,
          extraElement: null,
          eyebrowLeft: '-top-2 -left-1 rotate-12',
          eyebrowRight: '-top-2 -right-1 -rotate-12',
          mouthShape: 'big-smile',
          headTilt: 'animate-head-bob',
          blinkSpeed: 'animate-blink-happy'
        };
      case 'learning':
        return {
          bgGlow: 'shadow-[0_0_25px_rgba(251,191,36,0.5)]',
          eyePosition: '',
          pupilPosition: 'top-1.5 left-0.5',
          eyeScale: 'scale-95',
          pulseSpeed: 'animate-pulse',
          borderColor: 'border-amber-400',
          icon: <BookOpen className={`${s.icon} text-amber-300`} />,
          extraElement: null,
          eyebrowLeft: '-top-1 -left-0.5 -rotate-6 animate-brow-thoughtful',
          eyebrowRight: '-top-1 -right-0.5 rotate-6 animate-brow-thoughtful',
          mouthShape: 'thoughtful',
          headTilt: '-rotate-3',
          blinkSpeed: 'animate-blink-slow'
        };
      default:
        return {
          bgGlow: 'shadow-[0_0_20px_rgba(6,182,212,0.3)]',
          eyePosition: '',
          pupilPosition: 'top-1 left-1',
          eyeScale: 'scale-100',
          pulseSpeed: 'animate-pulse-slow',
          borderColor: 'border-cyan-400',
          icon: null,
          extraElement: null,
          eyebrowLeft: '-top-1 -left-0.5',
          eyebrowRight: '-top-1 -right-0.5',
          mouthShape: 'gentle-smile',
          headTilt: '',
          blinkSpeed: 'animate-blink-normal'
        };
    }
  };

  const styles = getStateStyles();

  const renderMouth = () => {
    const baseClasses = `absolute bottom-2 left-1/2 -translate-x-1/2`;
    
    switch(styles.mouthShape) {
      case 'sleeping':
        return (
          <div className={`${baseClasses} w-2 h-0.5 bg-white rounded-full opacity-40`}></div>
        );
      case 'open-happy':
        return (
          <div className={`${baseClasses} ${s.mouth} h-3 bg-slate-900 rounded-full border-2 border-white`}>
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-2 h-1.5 bg-pink-400 rounded-t-full"></div>
          </div>
        );
      case 'surprised':
        return (
          <div className={`${baseClasses} w-2 h-3 bg-slate-900 rounded-full border-2 border-white`}></div>
        );
      case 'big-smile':
        return (
          <div className={`${baseClasses} ${s.mouth} h-2 border-b-2 border-white rounded-full`}></div>
        );
      case 'concentrated':
        return (
          <div className={`${baseClasses} w-2 h-2 bg-slate-900 rounded-full border border-white`}></div>
        );
      case 'thoughtful':
        return (
          <div className={`${baseClasses} w-3 h-1 border-b border-white rounded-sm opacity-70`}></div>
        );
      default:
        return (
          <div className={`${baseClasses} ${s.smile} border-b-2 border-white rounded-full opacity-80`}></div>
        );
    }
  };

  return (
    <>
      <div className={`
        relative
        ${s.container}
        bg-gradient-to-br from-slate-800 to-slate-900
        rounded-lg
        border-2 ${styles.borderColor}
        ${styles.pulseSpeed}
        ${styles.bgGlow}
        ${styles.headTilt}
        transition-all duration-300
        flex items-center justify-center
      `}>
        <div className="absolute inset-0 overflow-hidden rounded-lg">
          <div className={`${s.particle} bg-cyan-400 rounded-full absolute top-2 left-2 animate-float-1`}></div>
          <div className={`${s.particle} bg-cyan-300 rounded-full absolute top-6 right-2 animate-float-2`}></div>
          <div className={`${s.particle} bg-cyan-500 rounded-full absolute bottom-2 left-4 animate-float-3`}></div>
        </div>

        <div className="relative z-10">
          <div className="relative">
            <div className={`absolute ${styles.eyebrowLeft} ${s.eyebrow} bg-white rounded-full transition-all duration-200`}></div>
            <div className={`absolute ${styles.eyebrowRight} ${s.eyebrow} bg-white rounded-full transition-all duration-200`}></div>
          </div>

          <div className={`relative flex gap-2 ${styles.eyePosition} ${styles.blinkSpeed}`}>
            <div className={`relative ${s.eye} ${styles.eyeScale} transition-all duration-200`}>
              <div className="absolute inset-0 bg-white rounded-full"></div>
              <div className={`absolute ${styles.pupilPosition} ${s.pupil} bg-slate-900 rounded-full transition-all duration-200`}>
                <div className={`absolute top-0.5 left-0.5 ${s.highlight} bg-cyan-300 rounded-full opacity-60`}></div>
              </div>
            </div>
            
            <div className={`relative ${s.eye} ${styles.eyeScale} transition-all duration-200`}>
              <div className="absolute inset-0 bg-white rounded-full"></div>
              <div className={`absolute ${styles.pupilPosition} ${s.pupil} bg-slate-900 rounded-full transition-all duration-200`}>
                <div className={`absolute top-0.5 left-0.5 ${s.highlight} bg-cyan-300 rounded-full opacity-60`}></div>
              </div>
            </div>
          </div>

          {renderMouth()}
        </div>

        {styles.icon && (
          <div className="absolute -top-1 -right-1">
            {styles.icon}
          </div>
        )}

        {styles.extraElement}
      </div>

      <style>{`
        @keyframes pulse-sleeping {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(0.98); }
        }
        
        @keyframes blink-sleeping {
          0%, 90%, 100% { transform: scaleY(0.2); }
          95% { transform: scaleY(0.5); }
        }
        
        @keyframes float-z1 {
          0% { transform: translate(0, 0); opacity: 0; }
          50% { opacity: 0.6; }
          100% { transform: translate(3px, -20px); opacity: 0; }
        }
        
        @keyframes float-z2 {
          0% { transform: translate(0, 0); opacity: 0; }
          50% { opacity: 0.4; }
          100% { transform: translate(-2px, -25px); opacity: 0; }
        }
        
        @keyframes pupil-dart {
          0% { transform: translate(0, 0); }
          20% { transform: translate(2px, -1px); }
          40% { transform: translate(-2px, 1px); }
          60% { transform: translate(1px, 2px); }
          80% { transform: translate(-1px, -2px); }
          100% { transform: translate(0, 0); }
        }
        
        @keyframes pupil-dance {
          0%, 100% { transform: translate(0, 0); }
          25% { transform: translate(-2px, -2px); }
          50% { transform: translate(2px, -1px); }
          75% { transform: translate(-1px, 2px); }
        }
        
        @keyframes brow-focus-left {
          0%, 100% { transform: translateY(0) rotate(-12deg); }
          50% { transform: translateY(-2px) rotate(-18deg); }
        }
        
        @keyframes brow-focus-right {
          0%, 100% { transform: translateY(0) rotate(12deg); }
          50% { transform: translateY(-2px) rotate(18deg); }
        }
        
        @keyframes brow-excited-left {
          0%, 100% { transform: translateY(0) rotate(12deg); }
          50% { transform: translateY(-3px) rotate(20deg); }
        }
        
        @keyframes brow-excited-right {
          0%, 100% { transform: translateY(0) rotate(-12deg); }
          50% { transform: translateY(-3px) rotate(-20deg); }
        }
        
        @keyframes brow-raise-left {
          0% { transform: translateY(0) rotate(0deg); }
          100% { transform: translateY(-4px) rotate(45deg); }
        }
        
        @keyframes brow-raise-right {
          0% { transform: translateY(0) rotate(0deg); }
          100% { transform: translateY(-4px) rotate(-45deg); }
        }
        
        @keyframes brow-thoughtful {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 1; }
        }
        
        @keyframes blink-normal {
          0%, 96%, 100% { transform: scaleY(1); }
          98% { transform: scaleY(0.1); }
        }
        
        @keyframes blink-fast {
          0%, 90%, 100% { transform: scaleY(1); }
          95% { transform: scaleY(0.1); }
        }
        
        @keyframes blink-slow {
          0%, 94%, 100% { transform: scaleY(1); }
          97% { transform: scaleY(0.1); }
        }
        
        @keyframes blink-excited {
          0%, 85%, 100% { transform: scaleY(1); }
          92% { transform: scaleY(0.1); }
        }
        
        @keyframes blink-happy {
          0%, 88%, 100% { transform: scaleY(1); }
          94% { transform: scaleY(0.1); }
        }
        
        @keyframes blink-surprised {
          0%, 100% { transform: scaleY(1.2); }
        }
        
        @keyframes head-shake-happy {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-5deg); }
          75% { transform: rotate(5deg); }
        }
        
        @keyframes head-tilt-curious {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(8deg); }
        }
        
        @keyframes head-bob {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-3px) rotate(2deg); }
        }
        
        @keyframes eyes-wide-pop {
          0% { transform: scale(1); }
          50% { transform: scale(1.4); }
          100% { transform: scale(1.25); }
        }
        
        @keyframes pulse-slow {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.02); }
        }
        
        @keyframes pulse-fast {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        
        @keyframes bounce-subtle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-2px); }
        }
        
        @keyframes victory-jump {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-8px) scale(1.1); }
        }
        
        @keyframes arm-left {
          0%, 100% { transform: rotate(-30deg); }
          50% { transform: rotate(-60deg); }
        }
        
        @keyframes arm-right {
          0%, 100% { transform: rotate(30deg); }
          50% { transform: rotate(60deg); }
        }
        
        @keyframes sparkle-burst {
          0% { transform: scale(0) rotate(0deg); opacity: 0; }
          50% { transform: scale(1.2) rotate(180deg); opacity: 1; }
          100% { transform: scale(1) rotate(360deg); opacity: 1; }
        }
        
        @keyframes star-burst-1 {
          0% { transform: translate(0, 0) scale(0); opacity: 0; }
          50% { transform: translate(-10px, -10px) scale(1); opacity: 1; }
          100% { transform: translate(-15px, -15px) scale(0.5); opacity: 0; }
        }
        
        @keyframes star-burst-2 {
          0% { transform: translate(0, 0) scale(0); opacity: 0; }
          50% { transform: translate(10px, -10px) scale(1); opacity: 1; }
          100% { transform: translate(15px, -15px) scale(0.5); opacity: 0; }
        }
        
        @keyframes eyes-squint {
          0%, 100% { transform: scaleY(1); }
          50% { transform: scaleY(0.4); }
        }
        
        @keyframes lightbulb-appear {
          0% { transform: translateY(10px) scale(0); opacity: 0; }
          50% { transform: translateY(-5px) scale(1.2); opacity: 1; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        
        @keyframes pulse-glow {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }
        
        @keyframes flash-once {
          0% { opacity: 0.8; }
          50% { opacity: 0; }
          100% { opacity: 0; }
        }
        
        @keyframes ray-1 {
          0%, 100% { transform: translateX(-50%) scale(1); opacity: 0.6; }
          50% { transform: translateX(-50%) scale(1.5); opacity: 0.3; }
        }
        
        @keyframes ray-2 {
          0%, 100% { transform: translateX(-50%) rotate(45deg) scale(1); opacity: 0.6; }
          50% { transform: translateX(-50%) rotate(45deg) scale(1.5); opacity: 0.3; }
        }
        
        @keyframes ray-3 {
          0%, 100% { transform: translateX(-50%) rotate(90deg) scale(1); opacity: 0.6; }
          50% { transform: translateX(-50%) rotate(90deg) scale(1.5); opacity: 0.3; }
        }
        
        @keyframes ray-4 {
          0%, 100% { transform: translateX(-50%) rotate(-45deg) scale(1); opacity: 0.6; }
          50% { transform: translateX(-50%) rotate(-45deg) scale(1.5); opacity: 0.3; }
        }
        
        @keyframes float-1 {
          0%, 100% { transform: translate(0, 0); opacity: 0.3; }
          50% { transform: translate(2px, -4px); opacity: 0.8; }
        }
        
        @keyframes float-2 {
          0%, 100% { transform: translate(0, 0); opacity: 0.4; }
          50% { transform: translate(-3px, 3px); opacity: 0.7; }
        }
        
        @keyframes float-3 {
          0%, 100% { transform: translate(0, 0); opacity: 0.5; }
          50% { transform: translate(3px, -2px); opacity: 0.9; }
        }
        
        .animate-pulse-sleeping { animation: pulse-sleeping 4s ease-in-out infinite; }
        .animate-blink-sleeping { animation: blink-sleeping 8s ease-in-out infinite; }
        .animate-float-z1 { animation: float-z1 3s ease-in-out infinite; }
        .animate-float-z2 { animation: float-z2 3.5s ease-in-out infinite 1s; }
        .animate-pupil-dart { animation: pupil-dart 1.5s ease-in-out infinite; }
        .animate-pupil-dance { animation: pupil-dance 0.8s ease-in-out infinite; }
        .animate-brow-focus-left { animation: brow-focus-left 1.5s ease-in-out infinite; }
        .animate-brow-focus-right { animation: brow-focus-right 1.5s ease-in-out infinite; }
        .animate-brow-excited-left { animation: brow-excited-left 0.4s ease-in-out infinite; }
        .animate-brow-excited-right { animation: brow-excited-right 0.4s ease-in-out infinite; }
        .animate-brow-raise-left { animation: brow-raise-left 0.4s ease-out forwards; }
        .animate-brow-raise-right { animation: brow-raise-right 0.4s ease-out forwards; }
        .animate-brow-thoughtful { animation: brow-thoughtful 2s ease-in-out infinite; }
        .animate-blink-normal { animation: blink-normal 5s ease-in-out infinite; }
        .animate-blink-fast { animation: blink-fast 2s ease-in-out infinite; }
        .animate-blink-slow { animation: blink-slow 7s ease-in-out infinite; }
        .animate-blink-excited { animation: blink-excited 1s ease-in-out infinite; }
        .animate-blink-happy { animation: blink-happy 3s ease-in-out infinite; }
        .animate-blink-surprised { animation: blink-surprised 0.3s ease-out forwards; }
        .animate-head-shake-happy { animation: head-shake-happy 0.5s ease-in-out; }
        .animate-head-tilt-curious { animation: head-tilt-curious 0.4s ease-out forwards; }
        .animate-head-bob { animation: head-bob 1s ease-in-out infinite; }
        .animate-eyes-wide-pop { animation: eyes-wide-pop 0.5s ease-out forwards; }
        .animate-float-1 { animation: float-1 3s ease-in-out infinite; }
        .animate-float-2 { animation: float-2 4s ease-in-out infinite 0.5s; }
        .animate-float-3 { animation: float-3 3.5s ease-in-out infinite 1s; }
        .animate-pulse-slow { animation: pulse-slow 3s ease-in-out infinite; }
        .animate-pulse-fast { animation: pulse-fast 0.8s ease-in-out infinite; }
        .animate-bounce-subtle { animation: bounce-subtle 2s ease-in-out infinite; }
        .animate-victory-jump { animation: victory-jump 0.6s ease-out; }
        .animate-arm-left { animation: arm-left 0.4s ease-in-out infinite; }
        .animate-arm-right { animation: arm-right 0.4s ease-in-out infinite; }
        .animate-sparkle-burst { animation: sparkle-burst 0.6s ease-out; }
        .animate-star-burst-1 { animation: star-burst-1 0.8s ease-out; }
        .animate-star-burst-2 { animation: star-burst-2 0.8s ease-out 0.1s; }
        .animate-eyes-squint { animation: eyes-squint 0.4s ease-in-out infinite; }
        .animate-lightbulb-appear { animation: lightbulb-appear 0.5s ease-out forwards; }
        .animate-pulse-glow { animation: pulse-glow 1s ease-in-out infinite; }
        .animate-flash-once { animation: flash-once 0.3s ease-out forwards; }
        .animate-ray-1 { animation: ray-1 1.5s ease-in-out infinite; }
        .animate-ray-2 { animation: ray-2 1.5s ease-in-out infinite 0.2s; }
        .animate-ray-3 { animation: ray-3 1.5s ease-in-out infinite 0.4s; }
        .animate-ray-4 { animation: ray-4 1.5s ease-in-out infinite 0.6s; }
      `}</style>
    </>
  );
};

const DipsyDemo = () => {
  const [currentState, setCurrentState] = useState('idle');
  const [currentSize, setCurrentSize] = useState('medium');
  
  useEffect(() => {
    const states = ['idle', 'thinking', 'confident-victory', 'confident-lightbulb', 'celebrating', 'learning'];
    let index = 0;
    const interval = setInterval(() => {
      index = (index + 1) % states.length;
      setCurrentState(states[index]);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center gap-6 p-8 bg-slate-900 rounded-lg min-h-screen">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white mb-2">Dipsy - Standalone Character</h1>
        <p className="text-slate-400">Pure character component, no button wrapper</p>
      </div>

      <div className="text-cyan-400 font-medium text-sm">
        State: <span className="text-white">{currentState}</span> | Size: <span className="text-white">{currentSize}</span>
      </div>

      <div className="flex items-center justify-center p-12 bg-slate-800 rounded-xl">
        <DipsyStandalone state={currentState} size={currentSize} />
      </div>

      <div className="flex gap-2">
        {['small', 'medium', 'large'].map(size => (
          <button
            key={size}
            onClick={() => setCurrentSize(size)}
            className={`
              px-4 py-2 rounded font-medium transition-all
              ${currentSize === size 
                ? 'bg-purple-600 text-white' 
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }
            `}
          >
            {size}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 justify-center max-w-lg">
        {['idle', 'thinking', 'confident-victory', 'confident-lightbulb', 'celebrating', 'learning'].map(state => (
          <button
            key={state}
            onClick={() => setCurrentState(state)}
            className={`
              px-3 py-1 rounded text-xs font-medium transition-all
              ${currentState === state 
                ? 'bg-cyan-600 text-white' 
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }
            `}
          >
            {state.replace('-', ' ')}
          </button>
        ))}
      </div>
    </div>
  );
};

export default DipsyDemo;
export { DipsyStandalone };