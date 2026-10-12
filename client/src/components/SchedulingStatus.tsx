import type { DemoAppointment, SchedulerActivity } from "../../../shared/api.ts";
import { formatDay, formatSlotRange } from "../../../shared/scheduling.ts";
import type { CallPhase } from "../lib/types.ts";
import { AlertIcon, CalendarIcon, CheckCircleIcon, ClockIcon, InfoIcon } from "./Icons.tsx";

interface Props {
  phase: CallPhase;
  callId: string | null;
  mismatch: string | null;
  activity: SchedulerActivity[];
  appointments: DemoAppointment[];
}

const LOG_ICON: Record<SchedulerActivity["kind"], typeof InfoIcon> = {
  available: CheckCircleIcon,
  booked: CalendarIcon,
  rescheduled: CalendarIcon,
  already_booked: InfoIcon,
  unavailable: ClockIcon,
  rejected: AlertIcon,
  invalid: AlertIcon,
};

const timeFmt = new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit", second: "2-digit" });

/**
 * Honest status of scheduling for the current call. Bookings only ever come
 * from the scheduler; this panel never infers one from what was said.
 */
export function SchedulingStatus({ phase, callId, mismatch, activity, appointments }: Props) {
  const booking = callId ? appointments.find((a) => a.callId === callId) : undefined;
  const last = callId ? activity.filter((a) => a.callId === callId).at(-1) : undefined;

  let tone: "neutral" | "success" | "warning" = "neutral";
  let title: string;
  let body: string;

  if (booking) {
    tone = "success";
    title = "Booked and validated by the scheduler";
    body = `${booking.customerName} · ${booking.service} · ${formatDay(booking.dateISO)} · ${formatSlotRange(booking)}`;
  } else if (mismatch) {
    tone = "warning";
    title = "Julia said it was booked — the scheduler disagrees";
    body =
      "No booking was accepted by the scheduling system, so nothing was added. Check that the agent's book_appointment function is set up (see README).";
  } else if (last && (last.kind === "unavailable" || last.kind === "rejected")) {
    tone = "warning";
    title = "That time isn't available";
    body = `${last.summary}. Julia offers a free time and waits for the caller to agree.`;
  } else if (last?.kind === "available") {
    title = "Time is free — waiting for confirmation";
    body = `${last.summary}. It's only booked once the caller confirms and the scheduler accepts it.`;
  } else if (last?.kind === "invalid") {
    tone = "warning";
    title = "Julia needs a clearer date or time";
    body = last.summary;
  } else if (phase === "live" || phase === "ending") {
    title = "Listening…";
    body = "Before confirming anything, Julia checks the live calendar for conflicts.";
  } else if (phase === "ended" && callId) {
    tone = "warning";
    title = "No appointment was booked on this call";
    body = "Nothing was added to the dashboard. Start a new conversation to try again.";
  } else {
    title = "Conflict-free scheduling is on";
    body = "Every appointment is a 60-minute slot, checked against all bookings in this demo before Julia can confirm it.";
  }

  const Icon = tone === "success" ? CheckCircleIcon : tone === "warning" ? AlertIcon : CalendarIcon;
  const log = activity.slice(-4).reverse();

  return (
    <section className={`capture capture--${tone}`} aria-labelledby="sched-title">
      <div className="capture__main" role="status" aria-live="polite">
        <span className="capture__icon">
          <Icon size={20} />
        </span>
        <div>
          <p className="capture__title" id="sched-title">{title}</p>
          <p className="capture__body">{body}</p>
        </div>
      </div>
      {log.length > 0 && (
        <div className="sched-log">
          <p className="sched-log__title">Scheduler activity</p>
          <ul>
            {log.map((e) => {
              const LogIcon = LOG_ICON[e.kind];
              return (
                <li key={e.id} className={`sched-log__item sched-log__item--${e.kind}`}>
                  <LogIcon size={14} />
                  <span className="sched-log__text">{e.summary}</span>
                  <time className="sched-log__time">{timeFmt.format(e.at)}</time>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
