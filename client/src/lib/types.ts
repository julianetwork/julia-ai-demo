import type { ExtractedBooking, MissingField } from "../../../shared/booking.ts";

export type CallPhase = "idle" | "requesting_mic" | "connecting" | "live" | "ending" | "ended" | "error";

/** What the orb shows; derived from the call phase plus who is talking. */
export type OrbState = "idle" | "connecting" | "listening" | "speaking" | "ended" | "error";

export type CaptureMethod = "live_transcript" | "post_call_transcript" | "post_call_analysis";

export interface Appointment extends ExtractedBooking {
  id: string;
  callId: string;
  /** confirmed = captured live, verification pending; verified = matches Retell's call record. */
  status: "confirmed" | "verified" | "needs_review";
  source: "Julia AI · Voice demo";
  method: CaptureMethod;
  capturedAt: number;
  evidence: string;
}

export interface CallError {
  kind: "mic_denied" | "no_mic" | "mic_busy" | "unsupported" | "insecure" | "server" | "connection";
  title: string;
  message: string;
}

/** The honest status of booking capture for the current/last call. */
export type CaptureOutcome =
  | { kind: "none" }
  | { kind: "listening" }
  | { kind: "captured"; booking: ExtractedBooking; verified: boolean }
  | { kind: "verifying"; hadLiveBooking: boolean }
  | { kind: "incomplete"; missing: MissingField[]; final: boolean }
  | { kind: "not_confirmed"; reason: "no_confirmation" | "cancelled" | "empty" }
  | { kind: "unverifiable"; reason: string; hadLiveBooking: boolean };

export type TranscriptState = "idle" | "connecting" | "connected" | "unavailable";
