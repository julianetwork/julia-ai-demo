export type CallPhase = "idle" | "requesting_mic" | "connecting" | "live" | "ending" | "ended" | "error";

/** What the orb shows; derived from the call phase plus who is talking. */
export type OrbState = "idle" | "connecting" | "listening" | "speaking" | "ended" | "error";

export interface CallError {
  kind: "mic_denied" | "no_mic" | "mic_busy" | "unsupported" | "insecure" | "server" | "connection";
  title: string;
  message: string;
}

export type TranscriptState = "idle" | "connecting" | "connected" | "unavailable";
