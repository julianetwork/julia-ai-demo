import type { CaptureOutcome } from "../lib/types.ts";
import { formatDate, listFields } from "../lib/format.ts";
import { AlertIcon, CheckCircleIcon, InfoIcon, SparkIcon } from "./Icons.tsx";

const FIELD_NAMES = { name: "the customer's name", date: "the date", time: "the time" } as const;

/**
 * Honest booking-capture status for the current call. It never claims a
 * booking unless Julia's confirmation was actually detected.
 */
export function CaptureStatus({ outcome }: { outcome: CaptureOutcome }) {
  let tone: "neutral" | "success" | "warning" = "neutral";
  let title = "";
  let body = "";

  switch (outcome.kind) {
    case "none":
      title = "Booking capture is on";
      body = "When Julia confirms an appointment on the call, it's added to the dashboard below automatically.";
      break;
    case "listening":
      title = "Listening for a confirmed booking…";
      body = "Ask Julia for a haircut. Once she repeats your details and confirms, it lands in the dashboard.";
      break;
    case "captured":
      tone = "success";
      title = outcome.verified ? "Booking captured and verified" : "Booking captured from the call";
      body = `${outcome.booking.customerName} · ${outcome.booking.service} · ${formatDate(outcome.booking.dateISO, outcome.booking.dateLabel)} at ${outcome.booking.time}${
        outcome.verified ? " — confirmed against Retell's call record." : " — will be double-checked when the call ends."
      }`;
      break;
    case "verifying":
      title = "Checking the call record…";
      body = outcome.hadLiveBooking
        ? "Verifying the captured booking against Retell's final transcript."
        : "Looking for a confirmed booking in Retell's final transcript.";
      break;
    case "incomplete":
      tone = "warning";
      title = outcome.final ? "Booking not added — details incomplete" : "Almost there…";
      body = outcome.final
        ? `Julia confirmed something, but ${listFields(outcome.missing.map((m) => FIELD_NAMES[m]))} couldn't be captured reliably, so nothing was added.`
        : `Waiting for ${listFields(outcome.missing.map((m) => FIELD_NAMES[m]))} before adding the booking.`;
      break;
    case "not_confirmed":
      tone = "warning";
      title = outcome.reason === "cancelled" ? "Booking cancelled on the call" : "No booking was confirmed";
      body =
        outcome.reason === "cancelled"
          ? "Julia cancelled the appointment, so it was removed from the dashboard."
          : "The call ended before Julia confirmed an appointment, so nothing was added. Start a new conversation to try again.";
      break;
    case "unverifiable":
      tone = "warning";
      title = outcome.hadLiveBooking ? "Booking captured live, not yet verified" : "Booking couldn't be verified";
      body = outcome.reason;
      break;
  }

  const Icon = tone === "success" ? CheckCircleIcon : tone === "warning" ? AlertIcon : outcome.kind === "none" ? SparkIcon : InfoIcon;
  return (
    <div className={`capture capture--${tone}`} role="status" aria-live="polite">
      <span className="capture__icon">
        <Icon size={20} />
      </span>
      <div>
        <p className="capture__title">{title}</p>
        <p className="capture__body">{body}</p>
      </div>
    </div>
  );
}
