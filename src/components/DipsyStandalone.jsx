import React, { useState, useEffect } from 'react';
import { Brain, Sparkles, ThumbsUp, BookOpen } from 'lucide-react';

const DipsyStandalone = ({ state = 'idle', size = 'medium' }) => {
  // Size configurations
  const sizes = {
    small: {
      container: 'w-10 h-10',
      eye: 'w-2.5 h-2.5',
      pupil: 'w-1 h-1',
      highlight: 'w-0.5 h-0.5',
      smile: 'w-3 h-1',
      particle: 'w-0.5 h-0.5',
      icon: 'w-2 h-2',
      lightbulb: 'w-4 h-5',
      arm: 'w-0.5 h-2',
      eyebrow: 'w-2 h-0.5',
      mouth: 'w-3',
      glow: '8px',
      innerGlow: '4px'
    },
    medium: {
      container: 'w-14 h-14',
      eye: 'w-3.5 h-3.5',
      pupil: 'w-1.5 h-1.5',
      highlight: 'w-1 h-1',
      smile: 'w-4 h-1.5',
      particle: 'w-1 h-1',
      icon: 'w-3 h-3',
      lightbulb: 'w-5 h-6',
      arm: 'w-1 h-3',
      eyebrow: 'w-3 h-0.5',
      mouth: 'w-5',
      glow: '15px',
      innerGlow: '8px'
    },
    large: {
      container: 'w-24 h-24',
      eye: 'w-6 h-6',
      pupil: 'w-2.5 h-2.5',
      highlight: 'w-1.5 h-1.5',
      smile: 'w-6 h-2',
      particle: 'w-1.5 h-1.5',
      icon: 'w-4 h-4',
      lightbulb: 'w-7 h-8',
      arm: 'w-1.5 h-4',
      eyebrow: 'w-5 h-1',
      mouth: 'w-8',
      glow: '25px',
      innerGlow: '12px'
    }
  };

  const s = sizes[size];

  const getStateStyles = () => {
    switch(state) {
      case 'sleeping':
        return {
          bgGradient: 'from-cyan-500/20 via-cyan-400/10 to-transparent',
          glowColor: 'rgba(6, 182, 212, 0.3)',
          borderColor: 'border-cyan-400/40',
          eyePosition: '',
          pupilPosition: 'top-1 left-1',
          eyeScale: 'scale-y-[0.15]',
          pulseSpeed: 'animate-pulse-sleeping',
          icon: null,
          extraElement: (
            <>
              <div className="absolute -top-6 -right-2 animate-float-z1">
                <span className="text-cyan-300 text-xs opacity-80 font-bold">z</span>
              </div>
              <div className="absolute -top-10 -right-1 animate-float-z2">
                <span className="text-cyan-300 text-sm opacity-60 font-bold">Z</span>
              </div>
            </>
          ),
          eyebrowLeft: '-top-0.5 -left-0.5 opacity-30',
          eyebrowRight: '-top-0.5 -right-0.5 opacity-30',
          mouthShape: 'sleeping',
          headTilt: 'rotate-3',
          blinkSpeed: '',
          faceGlow: 'drop-shadow-[0_0_3px_rgba(6,182,212,0.5)]'
        };
      case 'thinking':
        return {
          bgGradient: 'from-cyan-400/40 via-cyan-500/20 to-cyan-600/10',
          glowColor: 'rgba(6, 182, 212, 0.6)',
          borderColor: 'border-cyan-400',
          eyePosition: '',
          pupilPosition: 'animate-pupil-dart',
          eyeScale: 'scale-100',
          pulseSpeed: 'animate-pulse-fast',
          icon: <Brain className={`${s.icon} text-cyan-300 animate-spin drop-shadow-[0_0_4px_rgba(6,182,212,0.8)]`} />,
          extraElement: null,
          eyebrowLeft: '-top-1 -left-0.5 -rotate-12 animate-brow-focus-left',
          eyebrowRight: '-top-1 -right-0.5 rotate-12 animate-brow-focus-right',
          mouthShape: 'concentrated',
          headTilt: 'rotate-2',
          blinkSpeed: 'animate-blink-fast',
          faceGlow: 'drop-shadow-[0_0_6px_rgba(6,182,212,0.8)]'
        };
      case 'confident-victory':
        return {
          bgGradient: 'from-emerald-400/40 via-green-500/20 to-cyan-500/10',
          glowColor: 'rgba(34, 197, 94, 0.7)',
          borderColor: 'border-emerald-400',
          eyePosition: '',
          pupilPosition: '',
          eyeScale: 'scale-y-50 animate-eyes-squint',
          pulseSpeed: 'animate-victory-jump',
          icon: null,
          extraElement: (
            <>
              <div className={`absolute -left-3 top-1/2 -translate-y-1/2 ${s.arm} bg-gradient-to-t from-emerald-400 to-emerald-300 rounded-full animate-arm-left origin-bottom shadow-[0_0_8px_rgba(34,197,94,0.6)]`}></div>
              <div className={`absolute -right-3 top-1/2 -translate-y-1/2 ${s.arm} bg-gradient-to-t from-emerald-400 to-emerald-300 rounded-full animate-arm-right origin-bottom shadow-[0_0_8px_rgba(34,197,94,0.6)]`}></div>
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Sparkles className={`${s.icon} text-yellow-300 animate-sparkle-burst drop-shadow-[0_0_6px_rgba(253,224,71,0.8)]`} />
              </div>
              <div className={`absolute -top-1 -left-4 w-2 h-2 bg-yellow-300 rounded-full animate-star-burst-1 shadow-[0_0_6px_rgba(253,224,71,0.8)]`}></div>
              <div className={`absolute -top-1 -right-4 w-2 h-2 bg-emerald-300 rounded-full animate-star-burst-2 shadow-[0_0_6px_rgba(110,231,183,0.8)]`}></div>
            </>
          ),
          eyebrowLeft: '-top-2 -left-1 rotate-12 animate-brow-excited-left',
          eyebrowRight: '-top-2 -right-1 -rotate-12 animate-brow-excited-right',
          mouthShape: 'open-happy',
          headTilt: 'animate-head-shake-happy',
          blinkSpeed: 'animate-blink-excited',
          faceGlow: 'drop-shadow-[0_0_8px_rgba(34,197,94,0.8)]'
        };
      case 'confident-lightbulb':
        return {
          bgGradient: 'from-emerald-400/40 via-yellow-400/20 to-cyan-500/10',
          glowColor: 'rgba(34, 197, 94, 0.7)',
          borderColor: 'border-emerald-400',
          eyePosition: '',
          pupilPosition: 'top-0 left-1/2 -translate-x-1/2',
          eyeScale: 'scale-125 animate-eyes-wide-pop',
          pulseSpeed: 'animate-bounce-subtle',
          icon: null,
          extraElement: (
            <>
              <div className="absolute -top-10 left-1/2 -translate-x-1/2 animate-lightbulb-appear">
                <div className="relative">
                  <div className="absolute inset-0 bg-yellow-300 rounded-full blur-lg animate-pulse-glow"></div>
                  <div className={`relative ${s.lightbulb} bg-gradient-to-b from-yellow-200 to-yellow-400 rounded-t-full shadow-[0_0_20px_rgba(253,224,71,0.8)]`}>
                    <div className="absolute top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rounded-full opacity-90"></div>
                  </div>
                  <div className="w-3 h-2 bg-slate-600 mx-auto rounded-sm border border-slate-500"></div>
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                    <div className="absolute w-10 h-0.5 bg-yellow-300 opacity-60 animate-ray-1 shadow-[0_0_4px_rgba(253,224,71,0.6)]"></div>
                    <div className="absolute w-10 h-0.5 bg-yellow-300 opacity-60 animate-ray-2 rotate-45 shadow-[0_0_4px_rgba(253,224,71,0.6)]"></div>
                    <div className="absolute w-10 h-0.5 bg-yellow-300 opacity-60 animate-ray-3 rotate-90 shadow-[0_0_4px_rgba(253,224,71,0.6)]"></div>
                    <div className="absolute w-10 h-0.5 bg-yellow-300 opacity-60 animate-ray-4 -rotate-45 shadow-[0_0_4px_rgba(253,224,71,0.6)]"></div>
                  </div>
                </div>
              </div>
              <div className="absolute inset-0 bg-yellow-200/30 rounded-xl animate-flash-once"></div>
            </>
          ),
          eyebrowLeft: '-top-3 -left-1 rotate-45 animate-brow-raise-left',
          eyebrowRight: '-top-3 -right-1 -rotate-45 animate-brow-raise-right',
          mouthShape: 'surprised',
          headTilt: 'animate-head-tilt-curious',
          blinkSpeed: 'animate-blink-surprised',
          faceGlow: 'drop-shadow-[0_0_10px_rgba(253,224,71,0.6)]'
        };
      case 'celebrating':
        return {
          bgGradient: 'from-emerald-400/40 via-green-500/20 to-cyan-500/10',
          glowColor: 'rgba(34, 197, 94, 0.7)',
          borderColor: 'border-emerald-400',
          eyePosition: '',
          pupilPosition: 'animate-pupil-dance',
          eyeScale: 'scale-110',
          pulseSpeed: 'animate-bounce',
          icon: <ThumbsUp className={`${s.icon} text-emerald-300 animate-bounce drop-shadow-[0_0_4px_rgba(110,231,183,0.8)]`} />,
          extraElement: null,
          eyebrowLeft: '-top-2 -left-1 rotate-12',
          eyebrowRight: '-top-2 -right-1 -rotate-12',
          mouthShape: 'big-smile',
          headTilt: 'animate-head-bob',
          blinkSpeed: 'animate-blink-happy',
          faceGlow: 'drop-shadow-[0_0_8px_rgba(34,197,94,0.8)]'
        };
      case 'learning':
        return {
          bgGradient: 'from-amber-400/30 via-yellow-500/20 to-orange-400/10',
          glowColor: 'rgba(251, 191, 36, 0.5)',
          borderColor: 'border-amber-400',
          eyePosition: '',
          pupilPosition: 'top-1.5 left-0.5',
          eyeScale: 'scale-95',
          pulseSpeed: 'animate-pulse',
          icon: <BookOpen className={`${s.icon} text-amber-300 drop-shadow-[0_0_4px_rgba(251,191,36,0.8)]`} />,
          extraElement: null,
          eyebrowLeft: '-top-1 -left-0.5 -rotate-6 animate-brow-thoughtful',
          eyebrowRight: '-top-1 -right-0.5 rotate-6 animate-brow-thoughtful',
          mouthShape: 'thoughtful',
          headTilt: '-rotate-3',
          blinkSpeed: 'animate-blink-slow',
          faceGlow: 'drop-shadow-[0_0_6px_rgba(251,191,36,0.6)]'
        };
      default: // idle
        return {
          bgGradient: 'from-cyan-400/30 via-cyan-500/15 to-cyan-600/5',
          glowColor: 'rgba(6, 182, 212, 0.4)',
          borderColor: 'border-cyan-400/70',
          eyePosition: '',
          pupilPosition: 'top-1 left-1',
          eyeScale: 'scale-100',
          pulseSpeed: 'animate-pulse-slow',
          icon: null,
          extraElement: null,
          eyebrowLeft: '-top-1 -left-0.5',
          eyebrowRight: '-top-1 -right-0.5',
          mouthShape: 'gentle-smile',
          headTilt: '',
          blinkSpeed: 'animate-blink-normal',
          faceGlow: 'drop-shadow-[0_0_4px_rgba(6,182,212,0.6)]'
        };
    }
  };

  const styles = getStateStyles();

  const renderMouth = () => {
    const baseClasses = `absolute bottom-2 left-1/2 -translate-x-1/2`;
    
    switch(styles.mouthShape) {
      case 'sleeping':
        return (
          <div className={`${baseClasses} w-3 h-0.5 bg-cyan-200/50 rounded-full`}></div>
        );
      case 'open-happy':
        return (
          <div className={`${baseClasses} ${s.mouth} h-3 bg-slate-900/80 rounded-full border-2 border-cyan-200 shadow-[inset_0_0_4px_rgba(6,182,212,0.4)]`}>
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-2 h-1.5 bg-pink-400 rounded-t-full"></div>
          </div>
        );
      case 'surprised':
        return (
          <div className={`${baseClasses} w-3 h-4 bg-slate-900/80 rounded-full border-2 border-cyan-200 shadow-[inset_0_0_4px_rgba(6,182,212,0.4)]`}></div>
        );
      case 'big-smile':
        return (
          <div className={`${baseClasses} ${s.mouth} h-2 border-b-2 border-cyan-200 rounded-full`}></div>
        );
      case 'concentrated':
        return (
          <div className={`${baseClasses} w-2 h-2 bg-slate-900/60 rounded-full border border-cyan-200`}></div>
        );
      case 'thoughtful':
        return (
          <div className={`${baseClasses} w-3 h-1 border-b border-cyan-200/70 rounded-sm`}></div>
        );
      default: // gentle-smile
        return (
          <div className={`${baseClasses} ${s.smile} border-b-2 border-cyan-200 rounded-full`}></div>
        );
    }
  };

  return (
    <>
      <div 
        className={`
          relative
          ${s.container}
          rounded-xl
          border-2 ${styles.borderColor}
          ${styles.pulseSpeed}
          ${styles.headTilt}
          transition-all duration-300
          flex items-center justify-center
          overflow-visible
        `}
        style={{
          background: `linear-gradient(135deg, rgba(6, 182, 212, 0.15) 0%, rgba(6, 182, 212, 0.05) 50%, transparent 100%)`,
          boxShadow: `
            0 0 ${s.glow} ${styles.glowColor},
            inset 0 0 ${s.innerGlow} rgba(6, 182, 212, 0.2),
            0 0 2px rgba(6, 182, 212, 0.3)
          `,
          backdropFilter: 'blur(4px)'
        }}
      >
        {/* Holographic shimmer overlay */}
        <div 
          className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none"
          style={{
            background: 'linear-gradient(135deg, transparent 0%, rgba(255,255,255,0.03) 50%, transparent 100%)'
          }}
        >
          <div className="absolute inset-0 animate-shimmer opacity-30"
            style={{
              background: 'linear-gradient(90deg, transparent 0%, rgba(6,182,212,0.2) 50%, transparent 100%)',
              backgroundSize: '200% 100%'
            }}
          />
        </div>

        {/* Floating particles inside */}
        <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
          <div className={`${s.particle} bg-cyan-300 rounded-full absolute top-2 left-2 animate-float-1 shadow-[0_0_4px_rgba(6,182,212,0.8)]`}></div>
          <div className={`${s.particle} bg-cyan-200 rounded-full absolute top-6 right-2 animate-float-2 shadow-[0_0_4px_rgba(6,182,212,0.8)]`}></div>
          <div className={`${s.particle} bg-cyan-400 rounded-full absolute bottom-2 left-4 animate-float-3 shadow-[0_0_4px_rgba(6,182,212,0.8)]`}></div>
        </div>

        {/* Face container with glow */}
        <div className={`relative z-10 ${styles.faceGlow}`}>
          {/* Eyebrows */}
          <div className="relative">
            <div className={`absolute ${styles.eyebrowLeft} ${s.eyebrow} bg-cyan-200 rounded-full transition-all duration-200 shadow-[0_0_3px_rgba(6,182,212,0.6)]`}></div>
            <div className={`absolute ${styles.eyebrowRight} ${s.eyebrow} bg-cyan-200 rounded-full transition-all duration-200 shadow-[0_0_3px_rgba(6,182,212,0.6)]`}></div>
          </div>

          {/* Eyes */}
          <div className={`relative flex gap-2 ${styles.eyePosition} ${styles.blinkSpeed}`}>
            {/* Left eye */}
            <div className={`relative ${s.eye} ${styles.eyeScale} transition-all duration-200`}>
              <div className="absolute inset-0 bg-cyan-100 rounded-full shadow-[0_0_6px_rgba(6,182,212,0.8),inset_0_0_2px_rgba(255,255,255,0.5)]"></div>
              <div className={`absolute ${styles.pupilPosition} ${s.pupil} bg-slate-800 rounded-full transition-all duration-200`}>
                <div className={`absolute top-0.5 left-0.5 ${s.highlight} bg-white rounded-full`}></div>
              </div>
            </div>
            
            {/* Right eye */}
            <div className={`relative ${s.eye} ${styles.eyeScale} transition-all duration-200`}>
              <div className="absolute inset-0 bg-cyan-100 rounded-full shadow-[0_0_6px_rgba(6,182,212,0.8),inset_0_0_2px_rgba(255,255,255,0.5)]"></div>
              <div className={`absolute ${styles.pupilPosition} ${s.pupil} bg-slate-800 rounded-full transition-all duration-200`}>
                <div className={`absolute top-0.5 left-0.5 ${s.highlight} bg-white rounded-full`}></div>
              </div>
            </div>
          </div>

          {/* Mouth */}
          {renderMouth()}
        </div>

        {/* State icon */}
        {styles.icon && (
          <div className="absolute -top-1 -right-1">
            {styles.icon}
          </div>
        )}

        {/* Extra elements (arms, lightbulb, etc.) */}
        {styles.extraElement}

        {/* Corner accent lights */}
        <div className="absolute top-0 left-0 w-2 h-2 bg-cyan-400/30 rounded-br-full"></div>
        <div className="absolute top-0 right-0 w-2 h-2 bg-cyan-400/30 rounded-bl-full"></div>
      </div>

      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        
        @keyframes pulse-sleeping {
          0%, 100% { transform: scale(1); opacity: 0.7; }
          50% { transform: scale(0.98); opacity: 0.6; }
        }
        
        @keyframes float-z1 {
          0% { transform: translate(0, 0); opacity: 0; }
          50% { opacity: 0.8; }
          100% { transform: translate(3px, -20px); opacity: 0; }
        }
        
        @keyframes float-z2 {
          0% { transform: translate(0, 0); opacity: 0; }
          50% { opacity: 0.6; }
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
          0%, 100% { transform: scale(1); box-shadow: 0 0 15px rgba(6, 182, 212, 0.4); }
          50% { transform: scale(1.02); box-shadow: 0 0 25px rgba(6, 182, 212, 0.6); }
        }
        
        @keyframes pulse-fast {
          0%, 100% { transform: scale(1); box-shadow: 0 0 20px rgba(6, 182, 212, 0.5); }
          50% { transform: scale(1.05); box-shadow: 0 0 35px rgba(6, 182, 212, 0.8); }
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
          0% { opacity: 0.6; }
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
          0%, 100% { transform: translate(0, 0); opacity: 0.4; }
          50% { transform: translate(2px, -4px); opacity: 0.9; }
        }
        
        @keyframes float-2 {
          0%, 100% { transform: translate(0, 0); opacity: 0.5; }
          50% { transform: translate(-3px, 3px); opacity: 0.8; }
        }
        
        @keyframes float-3 {
          0%, 100% { transform: translate(0, 0); opacity: 0.6; }
          50% { transform: translate(3px, -2px); opacity: 1; }
        }
        
        .animate-shimmer { animation: shimmer 3s ease-in-out infinite; }
        .animate-pulse-sleeping { animation: pulse-sleeping 4s ease-in-out infinite; }
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

// Demo component for testing all states
const DipsyDemo = () => {
  const [currentState, setCurrentState] = useState('idle');
  const [currentSize, setCurrentSize] = useState('medium');
  const [autoPlay, setAutoPlay] = useState(false);
  
  useEffect(() => {
    if (!autoPlay) return;
    
    const states = ['idle', 'sleeping', 'thinking', 'confident-victory', 'confident-lightbulb', 'celebrating', 'learning'];
    let index = 0;
    const interval = setInterval(() => {
      index = (index + 1) % states.length;
      setCurrentState(states[index]);
    }, 3000);
    return () => clearInterval(interval);
  }, [autoPlay]);

  return (
    <div className="flex flex-col items-center gap-6 p-8 bg-zinc-900 rounded-lg min-h-screen">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white mb-2">Dipsy - Holographic Redesign</h1>
        <p className="text-zinc-400">Luminous AI assistant that glows on dark backgrounds</p>
      </div>

      <div className="text-cyan-400 font-medium text-sm">
        State: <span className="text-white">{currentState}</span> | Size: <span className="text-white">{currentSize}</span>
      </div>

      {/* Preview area with dark background to show the glow effect */}
      <div className="flex items-center justify-center p-16 bg-zinc-950 rounded-xl border border-zinc-800 min-w-[300px]">
        <DipsyStandalone state={currentState} size={currentSize} />
      </div>

      {/* Size controls */}
      <div className="flex gap-2">
        {['small', 'medium', 'large'].map(size => (
          <button
            key={size}
            onClick={() => setCurrentSize(size)}
            className={`
              px-4 py-2 rounded font-medium transition-all capitalize
              ${currentSize === size 
                ? 'bg-cyan-600 text-white' 
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
              }
            `}
          >
            {size}
          </button>
        ))}
      </div>

      {/* State controls */}
      <div className="flex flex-wrap gap-2 justify-center max-w-lg">
        {['idle', 'sleeping', 'thinking', 'confident-victory', 'confident-lightbulb', 'celebrating', 'learning'].map(state => (
          <button
            key={state}
            onClick={() => {
              setCurrentState(state);
              setAutoPlay(false);
            }}
            className={`
              px-3 py-1.5 rounded text-xs font-medium transition-all capitalize
              ${currentState === state 
                ? 'bg-cyan-600 text-white' 
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
              }
            `}
          >
            {state.replace('-', ' ')}
          </button>
        ))}
      </div>

      {/* Auto-play toggle */}
      <button
        onClick={() => setAutoPlay(!autoPlay)}
        className={`
          px-4 py-2 rounded font-medium transition-all
          ${autoPlay 
            ? 'bg-emerald-600 text-white' 
            : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
          }
        `}
      >
        {autoPlay ? '⏸ Stop Auto-Play' : '▶ Auto-Play States'}
      </button>

      {/* Side-by-side size comparison */}
      <div className="mt-8 p-6 bg-zinc-950 rounded-xl border border-zinc-800">
        <p className="text-zinc-400 text-sm mb-4 text-center">Size Comparison</p>
        <div className="flex items-end gap-8 justify-center">
          <div className="text-center">
            <DipsyStandalone state={currentState} size="small" />
            <p className="text-zinc-500 text-xs mt-2">Small</p>
          </div>
          <div className="text-center">
            <DipsyStandalone state={currentState} size="medium" />
            <p className="text-zinc-500 text-xs mt-2">Medium</p>
          </div>
          <div className="text-center">
            <DipsyStandalone state={currentState} size="large" />
            <p className="text-zinc-500 text-xs mt-2">Large</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DipsyDemo;
export { DipsyStandalone };