/** Types shared by the Express API and the React app. */
import type { ExtractionResult } from "./booking.ts";

export interface TranscriptEntry {
  id: string;
  role: "agent" | "user";
  content: string;
}

/** Server-Sent Events emitted by GET /api/calls/:callId/stream */
export type LiveEvent =
  | { type: "monitor"; state: "connecting" | "connected" | "unavailable"; message?: string }
  | { type: "transcript"; lines: TranscriptEntry[] }
  | { type: "booking"; result: ExtractionResult }
  | { type: "ended"; disconnectionReason: string | null };

/** Response of GET /api/calls/:callId/booking (post-call verification). */
export type BookingVerification =
  | { state: "pending"; reason: "call_in_progress" | "processing" }
  | { state: "unavailable"; reason: "call_not_connected" | "no_transcript" | "not_found" }
  | {
      state: "confirmed" | "incomplete" | "not_confirmed";
      method: "post_call_analysis" | "transcript";
      result: ExtractionResult;
      disconnectionReason: string | null;
    };
