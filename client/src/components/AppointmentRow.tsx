import type { Appointment } from "../lib/types.ts";
import { formatDate } from "../lib/format.ts";

const NEW_FOR_MS = 2 * 60_000;

const STATUS: Record<Appointment["status"], { label: string; hint: string }> = {
  confirmed: { label: "Confirmed", hint: "Captured live from the call; verification against Retell's call record is pending." },
  verified: { label: "Confirmed", hint: "Verified against Retell's call record." },
  needs_review: {
    label: "Needs review",
    hint: "Captured live, but the final call record didn't contain a complete confirmation.",
  },
};

const METHOD: Record<Appointment["method"], string> = {
  live_transcript: "live transcript",
  post_call_transcript: "call transcript",
  post_call_analysis: "post-call analysis",
};

export function AppointmentRow({ appointment: a, now }: { appointment: Appointment; now: number }) {
  const isNew = now - a.capturedAt < NEW_FOR_MS;
  const status = STATUS[a.status];
  return (
    <tr className={`appt-row ${isNew ? "appt-row--new" : ""}`}>
      <td data-label="Customer">
        <span className="appt-row__name">{a.customerName}</span>
        {isNew && <span className="badge badge--new">New</span>}
      </td>
      <td data-label="Service">{a.service}</td>
      <td data-label="Date" title={`Requested as “${a.dateLabel}”`}>
        {formatDate(a.dateISO, a.dateLabel)}
      </td>
      <td data-label="Time" className="tabular">{a.time}</td>
      <td data-label="Status">
        <span className={`status status--${a.status}`} title={status.hint}>
          <span className="dot" aria-hidden="true" />
          {status.label}
        </span>
        {a.status !== "needs_review" && (
          <span className="status__sub">{a.status === "verified" ? "Verified" : "Verifying…"}</span>
        )}
      </td>
      <td data-label="Source">
        <span className="source">{a.source}</span>
        <span className="status__sub">Demo · via {METHOD[a.method]}</span>
      </td>
    </tr>
  );
}
