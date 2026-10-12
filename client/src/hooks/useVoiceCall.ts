import { useCallback, useEffect, useRef, useState } from "react";
import type { WebCallSession } from "retell-client-js-sdk";
import type { LiveEvent, TranscriptEntry } from "../../../shared/api.ts";
import { loadRetellClient, SERVER_CONFIGURED_AGENT } from "../lib/retellClient.ts";
import type { CallError, CallPhase, OrbState, TranscriptState } from "../lib/types.ts";

export interface VoiceCallOptions {
  /** Resolves the demo session the call's bookings belong to. */
  getSessionId: () => Promise<string | null>;
}

const SPEAKING_THRESHOLD = 0.018;
const SPEAKING_HOLD_MS = 350;

const END_REASONS: Record<string, string> = {
  agent_hangup: "Julia ended the call.",
  inactivity: "The call ended after a period of silence.",
  max_duration_reached: "The call reached its maximum length.",
  concurrency_limit_reached: "Retell's concurrent-call limit was reached. Try again in a moment.",
  no_valid_payment: "The Retell account can't place calls right now (billing).",
  credit_exhausted: "The Retell account is out of credits.",
  error_no_audio_received: "Retell didn't receive audio from your microphone.",
  error_user_not_joined: "The browser didn't join the call in time.",
};

function micError(err: unknown): CallError {
  const name = (err as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return {
      kind: "mic_denied",
      title: "Microphone access is blocked",
      message:
        "Julia needs your microphone to hear you. Click the microphone or lock icon in your browser's address bar, allow access for this site, then try again.",
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
    return { kind: "no_mic", title: "No microphone found", message: "Connect a microphone or headset, then try again." };
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return {
      kind: "mic_busy",
      title: "Your microphone is busy",
      message: "Another app (Zoom, Teams, another tab…) may be using it. Close it and try again.",
    };
  }
  return { kind: "connection", title: "Couldn't start the microphone", message: "Please check your audio settings and try again." };
}

function connectionError(err: unknown): CallError {
  const status = (err as { status?: number })?.status;
  const message = err instanceof Error ? err.message : "";
  if (status === 429) return { kind: "server", title: "Too many calls", message };
  if (status === 409) return { kind: "server", title: "Demo session expired", message: message || "Please refresh the page and try again." };
  if (status && status >= 500) {
    return {
      kind: "server",
      title: "Julia is unavailable right now",
      message: message || "The demo server couldn't start a call. Please try again in a moment.",
    };
  }
  if (/NotAllowedError|Permission denied|permission/i.test(message)) return micError({ name: "NotAllowedError" });
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return { kind: "connection", title: "Can't reach the demo server", message: "Make sure the backend is running (npm run dev) and try again." };
  }
  return {
    kind: "connection",
    title: "The connection to Julia failed",
    message: "This can happen on restrictive networks or VPNs that block real-time audio. Please try again.",
  };
}

export function useVoiceCall({ getSessionId }: VoiceCallOptions) {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [muted, setMutedState] = useState(false);
  const mutedRef = useRef(false);
  const setMuted = (v: boolean) => {
    mutedRef.current = v;
    setMutedState(v);
  };
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<CallError | null>(null);
  const [endNote, setEndNote] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [transcriptState, setTranscriptState] = useState<TranscriptState>("idle");
  /** Id of the current/last call, used to match scheduler activity to it. */
  const [callId, setCallId] = useState<string | null>(null);
  /** Set when Julia announced a booking the scheduler never accepted. */
  const [mismatch, setMismatch] = useState<string | null>(null);

  const getSession = useRef(getSessionId);
  getSession.current = getSessionId;

  const sessionRef = useRef<WebCallSession | null>(null);
  const eventsRef = useRef<EventSource | null>(null);
  const generation = useRef(0);
  const wentLive = useRef(false);
  const userEnded = useRef(false);
  const endReason = useRef<string | null>(null);
  const finalized = useRef(false);
  const starting = useRef(false);

  // Audio-reactive orb: written straight to a CSS variable, no re-render per frame.
  const orbRef = useRef<HTMLDivElement | null>(null);
  const level = useRef(0);
  const lastLoud = useRef(0);
  const speakingRef = useRef(false);

  const setSpeakingIfChanged = (next: boolean) => {
    if (speakingRef.current !== next) {
      speakingRef.current = next;
      setSpeaking(next);
    }
  };

  const handleAudio = useCallback((samples: Float32Array) => {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / Math.max(1, samples.length));
    level.current = level.current * 0.75 + rms * 0.25;
    orbRef.current?.style.setProperty("--level", Math.min(1, level.current * 9).toFixed(3));
    const now = performance.now();
    if (level.current > SPEAKING_THRESHOLD) lastLoud.current = now;
    setSpeakingIfChanged(now - lastLoud.current < SPEAKING_HOLD_MS);
  }, []);

  const closeEvents = () => {
    eventsRef.current?.close();
    eventsRef.current = null;
  };

  /** Live transcript of the call, relayed by the server. */
  const openLiveStream = useCallback((id: string, gen: number) => {
    closeEvents();
    setTranscriptState("connecting");
    const es = new EventSource(`/api/calls/${encodeURIComponent(id)}/stream`);
    eventsRef.current = es;
    const guard = <T,>(fn: (data: T) => void) => (ev: MessageEvent) => {
      if (generation.current !== gen) return;
      try {
        fn(JSON.parse(ev.data) as T);
      } catch {
        /* ignore malformed frames */
      }
    };
    es.addEventListener("monitor", guard<Extract<LiveEvent, { type: "monitor" }>>((d) => setTranscriptState(d.state)));
    es.addEventListener(
      "transcript",
      guard<Extract<LiveEvent, { type: "transcript" }>>((d) => {
        setTranscriptState("connected");
        setTranscript(d.lines);
      }),
    );
    es.addEventListener("mismatch", guard<Extract<LiveEvent, { type: "mismatch" }>>((d) => setMismatch(d.evidence)));
    es.addEventListener("ended", guard<Extract<LiveEvent, { type: "ended" }>>((d) => (endReason.current = d.disconnectionReason)));
    es.onerror = () => {
      if (generation.current !== gen) return;
      if (es.readyState === EventSource.CLOSED) setTranscriptState((s) => (s === "connected" ? s : "unavailable"));
    };
  }, []);

  /** Single place where a call is wrapped up, whatever ended it. */
  const finalize = useCallback((gen: number) => {
    if (generation.current !== gen || finalized.current) return;
    finalized.current = true;
    sessionRef.current = null;
    setMuted(false);
    setSpeakingIfChanged(false);
    orbRef.current?.style.setProperty("--level", "0");

    if (!wentLive.current) {
      closeEvents();
      setPhase("error");
      setError((e) => e ?? connectionError(new Error("not connected")));
      return;
    }
    setPhase("ended");
    // Keep the transcript stream briefly for late frames (end reason, final words).
    window.setTimeout(() => {
      if (generation.current === gen) closeEvents();
    }, 4000);
    if (!userEnded.current) {
      window.setTimeout(() => {
        if (generation.current !== gen) return;
        const reason = endReason.current;
        setEndNote((reason && END_REASONS[reason]) || "The call ended unexpectedly. You can start a new conversation anytime.");
      }, 600);
    }
  }, []);

  const startCall = async () => {
    const gen = ++generation.current;
    closeEvents();
    wentLive.current = false;
    userEnded.current = false;
    endReason.current = null;
    finalized.current = false;
    setCallId(null);
    setMismatch(null);
    setError(null);
    setEndNote(null);
    setTranscript([]);
    setTranscriptState("idle");
    setMuted(false);

    if (!window.isSecureContext) {
      setPhase("error");
      setError({
        kind: "insecure",
        title: "Microphone needs a secure page",
        message: "Open the demo at http://localhost (or over HTTPS). Browsers block microphones on plain-HTTP network addresses.",
      });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      setPhase("error");
      setError({
        kind: "unsupported",
        title: "This browser can't make voice calls",
        message: "Please use a recent version of Chrome, Edge, Firefox or Safari.",
      });
      return;
    }

    // Ask for the microphone first so a denial is explained before any call is created.
    setPhase("requesting_mic");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      if (generation.current !== gen) return;
      setPhase("error");
      setError(micError(err));
      return;
    }
    if (generation.current !== gen) return;

    setPhase("connecting");
    let client;
    let demoSessionId: string | null;
    try {
      [client, demoSessionId] = await Promise.all([loadRetellClient(), getSession.current()]);
    } catch {
      if (generation.current !== gen) return;
      setPhase("error");
      setError({ kind: "connection", title: "Couldn't load the voice client", message: "Check your connection and reload the page." });
      return;
    }
    if (generation.current !== gen) return;
    if (!demoSessionId) {
      setPhase("error");
      setError({ kind: "server", title: "Can't reach the demo server", message: "The scheduling service isn't responding. Please refresh the page." });
      return;
    }

    const session = client.createWebCall({
      agent_id: SERVER_CONFIGURED_AGENT,
      // Ties the call to this page's demo calendar; the server validates it.
      metadata: { demo_session_id: demoSessionId },
      audio: { emitRawAudioSamples: true },
      hooks: {
        onStatus: (status) => {
          if (generation.current !== gen) return;
          if (status === "live") {
            wentLive.current = true;
            setPhase("live");
            const id = session.callId ?? null;
            setCallId(id);
            if (id) openLiveStream(id, gen);
          } else if (status === "ended") {
            finalize(gen);
          }
        },
        onEnd: () => finalize(gen),
        onAudio: handleAudio,
        onError: (err) => {
          if (generation.current !== gen) return;
          console.warn("[julia] call error:", err);
          // Errors before the call is live are fatal and explained to the visitor;
          // later ones are either non-fatal or followed by an "ended" status.
          if (!wentLive.current) setError(connectionError(err));
        },
      },
    });
    sessionRef.current = session;
    session.ready.catch(() => {
      /* surfaced through onError / onStatus */
    });
  };

  const start = useCallback(async () => {
    if (sessionRef.current || starting.current) return;
    starting.current = true;
    try {
      await startCall();
    } finally {
      starting.current = false;
    }
    // startCall only uses refs and stable callbacks.
  }, []);

  const end = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    userEnded.current = true;
    setPhase("ending");
    void session.end();
  }, []);

  const toggleMute = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const next = !mutedRef.current;
    if (next) session.mute();
    else session.unmute();
    mutedRef.current = next;
    setMuted(next);
  }, []);

  /** Clears everything about the current/last call (used by Reset Demo). */
  const reset = useCallback(() => {
    generation.current++;
    userEnded.current = true;
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) void session.end();
    closeEvents();
    setPhase("idle");
    setMuted(false);
    setSpeakingIfChanged(false);
    setError(null);
    setEndNote(null);
    setTranscript([]);
    setTranscriptState("idle");
    setCallId(null);
    setMismatch(null);
    orbRef.current?.style.setProperty("--level", "0");
  }, []);

  // Leaving the page or unmounting must never leave a call (or microphone) open.
  useEffect(() => {
    const onUnload = () => sessionRef.current?.disconnect();
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      generation.current++;
      sessionRef.current?.disconnect();
      sessionRef.current = null;
      closeEvents();
    };
  }, []);

  const orbState: OrbState =
    phase === "idle"
      ? "idle"
      : phase === "requesting_mic" || phase === "connecting" || phase === "ending"
        ? "connecting"
        : phase === "live"
          ? speaking
            ? "speaking"
            : "listening"
          : phase === "error"
            ? "error"
            : "ended";

  return {
    phase,
    orbState,
    muted,
    error,
    endNote,
    transcript,
    transcriptState,
    callId,
    mismatch,
    orbRef,
    start,
    end,
    toggleMute,
    reset,
  };
}
