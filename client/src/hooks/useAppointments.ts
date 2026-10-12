import { useCallback, useReducer } from "react";
import type { ExtractedBooking } from "../../../shared/booking.ts";
import type { Appointment, CaptureMethod } from "../lib/types.ts";

/**
 * Demo appointments, held in React memory only.
 * Deliberately no localStorage/sessionStorage/database: a refresh or the
 * Reset Demo button returns the dashboard to empty for the next prospect.
 * One appointment per call id, so repeated live/verification signals for the
 * same call update the row instead of duplicating it.
 */
type Action =
  | { type: "captured"; callId: string; booking: ExtractedBooking; method: CaptureMethod; verified: boolean; evidence: string }
  | { type: "flag_for_review"; callId: string }
  | { type: "remove"; callId: string }
  | { type: "reset" };

function reducer(state: Appointment[], action: Action): Appointment[] {
  switch (action.type) {
    case "captured": {
      const existing = state.find((a) => a.callId === action.callId);
      const status: Appointment["status"] = action.verified ? "verified" : "confirmed";
      if (existing) {
        return state.map((a) =>
          a.callId === action.callId
            ? { ...a, ...action.booking, status, method: action.method, evidence: action.evidence }
            : a,
        );
      }
      const appointment: Appointment = {
        ...action.booking,
        id: `demo-${action.callId}`,
        callId: action.callId,
        status,
        source: "Julia AI · Voice demo",
        method: action.method,
        capturedAt: Date.now(),
        evidence: action.evidence,
      };
      return [appointment, ...state];
    }
    case "flag_for_review":
      return state.map((a) => (a.callId === action.callId ? { ...a, status: "needs_review" } : a));
    case "remove":
      return state.filter((a) => a.callId !== action.callId);
    case "reset":
      return [];
  }
}

export function useAppointments() {
  const [appointments, dispatch] = useReducer(reducer, []);

  const capture = useCallback(
    (callId: string, booking: ExtractedBooking, method: CaptureMethod, verified: boolean, evidence: string) =>
      dispatch({ type: "captured", callId, booking, method, verified, evidence }),
    [],
  );
  const flagForReview = useCallback((callId: string) => dispatch({ type: "flag_for_review", callId }), []);
  const remove = useCallback((callId: string) => dispatch({ type: "remove", callId }), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  return { appointments, capture, flagForReview, remove, reset };
}

export { reducer as appointmentsReducer };
