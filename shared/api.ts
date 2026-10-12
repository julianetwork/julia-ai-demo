/** Types shared by the Express API and the React app. */
import type { BusinessHours } from "./scheduling.ts";

export interface TranscriptEntry {
  id: string;
  role: "agent" | "user";
  content: string;
}

/** Server-Sent Events emitted by GET /api/calls/:callId/stream */
export type LiveEvent =
  | { type: "monitor"; state: "connecting" | "connected" | "unavailable"; message?: string }
  | { type: "transcript"; lines: TranscriptEntry[] }
  /** Julia *said* a booking was confirmed, but the scheduler holds no booking for this call. */
  | { type: "mismatch"; evidence: string }
  | { type: "ended"; disconnectionReason: string | null };

/** A confirmed demo appointment, validated by the scheduler (60-minute slot). */
export interface DemoAppointment {
  id: string;
  callId: string | null;
  customerName: string;
  service: string;
  dateISO: string;
  startMinutes: number;
  createdAt: number;
}

export type SchedulerActivityKind = "available" | "unavailable" | "booked" | "rescheduled" | "already_booked" | "rejected" | "invalid";

export interface SchedulerActivity {
  id: string;
  at: number;
  callId: string | null;
  kind: SchedulerActivityKind;
  summary: string;
}

export interface DemoSessionInfo {
  id: string;
  timeZone: string;
  hours: BusinessHours;
  slotMinutes: number;
}

/** Server-Sent Events emitted by GET /api/demo-sessions/:id/events */
export type SessionEvent =
  | { type: "appointments"; appointments: DemoAppointment[] }
  | { type: "activity"; entry: SchedulerActivity }
  | { type: "activity_log"; entries: SchedulerActivity[] };
