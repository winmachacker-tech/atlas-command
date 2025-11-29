// FILE: src/hooks/useDipsyVoiceClient.js
//
// Purpose:
// - Provide a React hook for the Dipsy voice UI to talk to the Node
//   voice server over WebSocket.
//
// What this hook does:
// - Opens a WebSocket to VITE_DIPSY_VOICE_WS_URL (e.g. ws://localhost:3001).
// - On connect, fetches the current Supabase session and sends:
//       { type: "auth", access_token: "<user_jwt>" }
//   so the voice server can call Supabase with full RLS protection.
// - Exposes simple controls to the UI:
//       startListening()  -> start sending mic audio + "start_user_input"
//       stopListening()   -> stop sending audio + "stop_user_input"
//       playScript(text)  -> ask Dipsy to say a given text
//       reloadBrain()     -> ask voice server to reload its brain file
// - Tracks state:
//       isSupported, isConnected, isListening, isSpeaking,
//       lastTranscript, error.
//
// SECURITY:
// - Uses only the Supabase user JWT from supabase.auth.getSession().
// - Never uses the service-role key.
// - Sends the JWT only to your own voice server via WebSocket.
// - The voice server then calls Supabase with Authorization: Bearer <token>,
//   so Row Level Security remains fully enforced.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

// OpenAI Realtime outputs 24kHz PCM16 audio
const OPENAI_SAMPLE_RATE = 24000;

/**
 * Detect whether this browser/environment supports the features
 * we need for Dipsy Voice (WebSocket + mic + AudioContext).
 */
function detectSupport() {
  if (typeof window === "undefined") return false;
  if (typeof navigator === "undefined") return false;

  const hasWS = !!window.WebSocket;
  const hasMediaDevices =
    !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia;
  const hasAudioContext =
    !!window.AudioContext || !!window.webkitAudioContext;

  return hasWS && hasMediaDevices && hasAudioContext;
}

/**
 * Convert Float32 audio samples to 16-bit PCM.
 * The voice server expects raw PCM16 frames over the WebSocket.
 */
function floatTo16BitPCM(float32Buffer) {
  const len = float32Buffer.length;
  const buffer = new ArrayBuffer(len * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < len; i++) {
    let s = Math.max(-1, Math.min(1, float32Buffer[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(i * 2, s, true);
  }

  return buffer;
}

/**
 * AudioPlayerQueue
 * 
 * Manages sequential playback of PCM16 audio chunks from OpenAI.
 * Each chunk is scheduled to play immediately after the previous one finishes,
 * preventing overlap that causes garbled/fast audio.
 */
class AudioPlayerQueue {
  constructor() {
    this.audioContext = null;
    this.nextPlayTime = 0;
  }

  init() {
    if (this.audioContext) return;

    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      console.warn("[DipsyVoice] AudioContext not supported");
      return;
    }

    this.audioContext = new Ctor();
  }

  async resume() {
    if (this.audioContext && this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  // Reset queue timing (call when new response starts)
  reset() {
    this.nextPlayTime = 0;
  }

  // Queue a PCM16 ArrayBuffer for sequential playback
  async playChunk(arrayBuffer) {
    if (!arrayBuffer || arrayBuffer.byteLength === 0) return;

    this.init();
    if (!this.audioContext) return;

    await this.resume();

    const audioContext = this.audioContext;
    const currentTime = audioContext.currentTime;

    // Convert PCM16 (Int16) to Float32
    const int16View = new Int16Array(arrayBuffer);
    const float32Array = new Float32Array(int16View.length);

    for (let i = 0; i < int16View.length; i++) {
      float32Array[i] = int16View[i] / 0x8000;
    }

    // Create buffer at OpenAI's sample rate (24kHz)
    // The browser will resample to output device rate automatically
    const audioBuffer = audioContext.createBuffer(
      1, // mono
      float32Array.length,
      OPENAI_SAMPLE_RATE // 24000 Hz
    );
    audioBuffer.getChannelData(0).set(float32Array);

    // Calculate duration of this chunk
    const duration = float32Array.length / OPENAI_SAMPLE_RATE;

    // Schedule to play after any previously queued audio
    // If we've fallen behind, start from now
    const startTime = Math.max(this.nextPlayTime, currentTime);

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start(startTime);

    // Update next play time
    this.nextPlayTime = startTime + duration;
  }

  close() {
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch (e) {
        // ignore
      }
      this.audioContext = null;
    }
    this.nextPlayTime = 0;
  }
}

/**
 * Hook: useDipsyVoiceClient
 *
 * Typical usage in your Dipsy UI:
 *
 * const {
 *   isSupported,
 *   isConnected,
 *   isListening,
 *   isSpeaking,
 *   lastTranscript,
 *   error,
 *   startListening,
 *   stopListening,
 *   playScript,
 *   reloadBrain,
 * } = useDipsyVoiceClient();
 */
export function useDipsyVoiceClient() {
  const [isSupported] = useState(() => detectSupport());
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const accessTokenRef = useRef(null);

  // Audio playback queue (for Dipsy's voice)
  const audioPlayerRef = useRef(null);

  // Mic capture refs
  const micAudioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const processorNodeRef = useRef(null);

  // Initialize audio player on mount
  useEffect(() => {
    audioPlayerRef.current = new AudioPlayerQueue();
    return () => {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.close();
        audioPlayerRef.current = null;
      }
    };
  }, []);

  // ============================
  // Supabase auth → access token
  // ============================

  // Load the current session once on mount
  useEffect(() => {
    let isCancelled = false;

    async function loadSession() {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          console.error("[DipsyVoice] Failed to get Supabase session:", sessionError);
          if (!isCancelled) {
            setError("Could not read login session for Dipsy voice.");
          }
          return;
        }

        const token = data?.session?.access_token || null;
        accessTokenRef.current = token;

        if (!token) {
          console.warn(
            "[DipsyVoice] No Supabase access token found. Tools will not work until user logs in."
          );
        }
      } catch (err) {
        console.error("[DipsyVoice] Error fetching Supabase session:", err);
        if (!isCancelled) {
          setError("Unexpected error reading login session for Dipsy voice.");
        }
      }
    }

    loadSession();

    // Subscribe to auth changes so token updates if user logs in/out
    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        accessTokenRef.current = session?.access_token || null;
      }
    );

    return () => {
      isCancelled = true;
      listener?.subscription?.unsubscribe?.();
    };
  }, []);

  // ==========================
  // WebSocket connection setup
  // ==========================

  const connectWebSocket = useCallback(() => {
    if (!isSupported) {
      setError("Voice is not supported in this browser.");
      return null;
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return wsRef.current;
    }

    const url =
      import.meta.env.VITE_DIPSY_VOICE_WS_URL || "ws://localhost:3001";

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      setIsConnected(true);
      setError(null);

      // For debugging in DevTools:
      if (typeof window !== "undefined") {
        window.dipsyVoiceSocket = ws;
      }

      // Send auth token once we connect, if we have it
      const token = accessTokenRef.current;
      if (token) {
        try {
          ws.send(
            JSON.stringify({
              type: "auth",
              access_token: token,
            })
          );
        } catch (err) {
          console.error("[DipsyVoice] Failed to send auth over WS:", err);
        }
      } else {
        console.warn(
          "[DipsyVoice] No Supabase access token available at WS connect. Tools may not work until token is refreshed."
        );
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setIsSpeaking(false);
      // Let the UI decide if/when to reconnect
    };

    ws.onerror = (event) => {
      console.error("[DipsyVoice] WebSocket error:", event);
      setError("There was a problem talking to the Dipsy voice server.");
    };

    ws.onmessage = (event) => {
      // Binary audio from the server (PCM16)
      if (event.data instanceof ArrayBuffer) {
        if (audioPlayerRef.current) {
          audioPlayerRef.current.playChunk(event.data);
        }
        return;
      }

      // Text JSON message
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case "speaking_started":
              setIsSpeaking(true);
              // Reset audio queue for new response
              if (audioPlayerRef.current) {
                audioPlayerRef.current.reset();
              }
              break;
            case "speaking_stopped":
              setIsSpeaking(false);
              break;
            case "dipsy_transcript":
              if (typeof msg.text === "string") {
                setLastTranscript(msg.text);
              }
              break;
            case "error":
              if (msg.message) {
                setError(msg.message);
              } else {
                setError("Unknown error from Dipsy voice server.");
              }
              break;
            case "auth_ack":
              // Simple ack; nothing to do.
              break;
            default:
              // Ignore other message types
              break;
          }
        } catch (err) {
          console.warn("[DipsyVoice] Failed to parse WS message:", err);
        }
      }
    };

    return ws;
  }, [isSupported]);

  // ====================
  // Mic capture pipeline
  // ====================

  const cleanupMicNodes = useCallback(() => {
    try {
      processorNodeRef.current?.disconnect();
      sourceNodeRef.current?.disconnect();
      mediaStreamRef.current?.getTracks()?.forEach((t) => t.stop());
      micAudioContextRef.current?.close();
    } catch (err) {
      // ignore
    }

    processorNodeRef.current = null;
    sourceNodeRef.current = null;
    mediaStreamRef.current = null;
    micAudioContextRef.current = null;
  }, []);

  const startListening = useCallback(async () => {
    setError(null);

    if (!isSupported) {
      setError("Voice is not supported in this browser.");
      return;
    }

    const ws = connectWebSocket();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError("Dipsy voice server is not connected yet.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not support microphone access.");
      return;
    }

    // Tell the voice server we are about to send input audio
    try {
      ws.send(
        JSON.stringify({
          type: "start_user_input",
        })
      );
    } catch (err) {
      console.error("[DipsyVoice] Failed to send start_user_input:", err);
      setError("Could not start voice input.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const Ctor = window.AudioContext || window.webkitAudioContext;
      const audioContext = new Ctor();

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (event) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          return;
        }

        const inputBuffer = event.inputBuffer.getChannelData(0);
        const pcm16 = floatTo16BitPCM(inputBuffer);
        wsRef.current.send(pcm16);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      micAudioContextRef.current = audioContext;
      mediaStreamRef.current = stream;
      sourceNodeRef.current = source;
      processorNodeRef.current = processor;

      setIsListening(true);
    } catch (err) {
      console.error("[DipsyVoice] Error starting microphone:", err);
      setError("Could not access your microphone. Check permissions.");
      try {
        ws.send(
          JSON.stringify({
            type: "stop_user_input",
          })
        );
      } catch (_err) {
        // ignore
      }
    }
  }, [connectWebSocket, isSupported]);

  const stopListening = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setIsListening(false);
      cleanupMicNodes();
      return;
    }

    // Stop sending audio immediately
    setIsListening(false);
    cleanupMicNodes();

    try {
      // Tell server we are done; it will commit the buffer and create a response
      ws.send(
        JSON.stringify({
          type: "stop_user_input",
        })
      );
    } catch (err) {
      console.error("[DipsyVoice] Failed to send stop_user_input:", err);
    }
  }, [cleanupMicNodes]);

  // ====================
  // Extra control helpers
  // ====================

  const playScript = useCallback(
    (text) => {
      const ws = connectWebSocket();
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setError("Dipsy voice server is not connected.");
        return;
      }

      const script = (text || "").toString().trim();
      if (!script) return;

      try {
        ws.send(
          JSON.stringify({
            type: "play_script",
            text: script,
          })
        );
      } catch (err) {
        console.error("[DipsyVoice] Failed to send play_script:", err);
        setError("Could not send script to Dipsy.");
      }
    },
    [connectWebSocket]
  );

  const reloadBrain = useCallback(() => {
    const ws = connectWebSocket();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError("Dipsy voice server is not connected.");
      return;
    }

    try {
      ws.send(
        JSON.stringify({
          type: "reload_brain",
        })
      );
    } catch (err) {
      console.error("[DipsyVoice] Failed to send reload_brain:", err);
      setError("Could not reload Dipsy brain.");
    }
  }, [connectWebSocket]);

  // ====================
  // Cleanup on unmount
  // ====================

  useEffect(() => {
    return () => {
      setIsListening(false);
      cleanupMicNodes();
      if (audioPlayerRef.current) {
        audioPlayerRef.current.close();
      }
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch (err) {
          // ignore
        }
        wsRef.current = null;
      }
    };
  }, [cleanupMicNodes]);

  return {
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
  };
}