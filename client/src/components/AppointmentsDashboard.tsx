import { useEffect, useMemo, useRef, useState } from "react";
import type { DemoAppointment, DemoSessionInfo } from "../../../shared/api.ts";
import { compareSlots, formatMinutes, isInPast, nextOpenSlot, shopClock, DEFAULT_HOURS } from "../../../shared/scheduling.ts";
import { formatDate } from "../lib/format.ts";
import { AppointmentRow } from "./AppointmentRow.tsx";
import { ResetDemoButton } from "./ResetDemoButton.tsx";
import { CalendarIcon, ClockIcon, InfoIcon, ScissorsIcon, UsersIcon } from "./Icons.tsx";

interface Props {
  appointments: DemoAppointment[];
  session: DemoSessionInfo | null;
  notice: string | null;
  onReset: () => void;
}

const NEW_FOR_MS = 2 * 60_000;

export function AppointmentsDashboard({ appointments, session, notice, onReset }: Props) {
  // Re-render every 30 s so "New" badges expire and "Today"/"Next open" stay correct.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // When each appointment first appeared on this page (drives the "New" badge).
  const firstSeen = useRef(new Map<string, number>());
  for (const a of appointments) {
    if (!firstSeen.current.has(`${a.id}:${a.createdAt}`)) firstSeen.current.set(`${a.id}:${a.createdAt}`, Date.now());
  }
  useEffect(() => setNow(Date.now()), [appointments]);

  const timeZone = session?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hours = session?.hours ?? DEFAULT_HOURS;

  // Same availability rules the scheduler uses to validate bookings.
  const stats = useMemo(() => {
    const clock = shopClock(timeZone, new Date(now));
    const upcoming = appointments.filter((a) => !isInPast(a, clock)).sort(compareSlots);
    return {
      total: appointments.length,
      today: appointments.filter((a) => a.dateISO === clock.dateISO).length,
      next: upcoming[0] ?? null,
      open: nextOpenSlot(appointments, { hours, now: clock }),
    };
  }, [appointments, timeZone, hours, now]);

  const newest = [...appointments].sort((a, b) => b.createdAt - a.createdAt)[0];

  return (
    <section className="section dashboard-section" id="appointments" aria-labelledby="appointments-title">
      <div className="container">
        <div className="dashboard">
          <header className="dashboard__header">
            <div>
              <p className="dashboard__shop">
                <ScissorsIcon size={16} /> Demo Barbershop · Front desk · Open {formatMinutes(hours.open)} – {formatMinutes(hours.close)}
              </p>
              <h2 id="appointments-title" className="dashboard__title">Appointments</h2>
            </div>
            <ResetDemoButton onReset={onReset} />
          </header>

          <p className="dashboard__notice">
            <InfoIcon size={16} />
            {notice ??
              "Simulated demo data for this page session only — nothing is saved, sent or added to a real calendar. Every appointment is a 60-minute slot; overlapping bookings are refused."}
          </p>

          <div className="stats" role="list">
            <div className="stat" role="listitem">
              <span className="stat__icon"><CalendarIcon size={18} /></span>
              <span className="stat__label">Total appointments</span>
              <span className="stat__value" aria-live="polite">{stats.total}</span>
            </div>
            <div className="stat" role="listitem">
              <span className="stat__icon"><ClockIcon size={18} /></span>
              <span className="stat__label">Today</span>
              <span className="stat__value">{stats.today}</span>
            </div>
            <div className="stat" role="listitem">
              <span className="stat__icon"><UsersIcon size={18} /></span>
              <span className="stat__label">Next up</span>
              <span className="stat__value stat__value--text">
                {stats.next ? `${stats.next.customerName} · ${formatDate(stats.next.dateISO, "")}, ${formatMinutes(stats.next.startMinutes)}` : "—"}
              </span>
            </div>
            <div className="stat stat--brand" role="listitem">
              <span className="stat__icon"><ScissorsIcon size={18} /></span>
              <span className="stat__label">Next open slot</span>
              <span className="stat__value stat__value--text">
                {stats.open ? `${formatDate(stats.open.dateISO, "")}, ${formatMinutes(stats.open.startMinutes)}` : "—"}
              </span>
            </div>
          </div>

          <p className="sr-only" aria-live="polite">
            {newest ? `Appointment booked: ${newest.customerName}, ${formatDate(newest.dateISO, "", true)} at ${formatMinutes(newest.startMinutes)}.` : ""}
          </p>

          {appointments.length === 0 ? (
            <div className="empty">
              <div className="empty__art" aria-hidden="true">
                <CalendarIcon size={30} />
              </div>
              <h3 className="empty__title">No appointments yet</h3>
              <p className="empty__text">
                Start a conversation with Julia and book a haircut as if you were a customer. Once the scheduler accepts
                the slot and Julia confirms it, the appointment appears here — no refresh needed. Try booking the same
                time twice to see Julia offer an alternative.
              </p>
              <a href="#demo" className="btn btn--primary">Talk to Julia</a>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="appt-table">
                <caption className="sr-only">Appointments booked by Julia during this demo</caption>
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col">Service</th>
                    <th scope="col">Date</th>
                    <th scope="col">Time</th>
                    <th scope="col">Status</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((a) => (
                    <AppointmentRow
                      key={a.id}
                      appointment={a}
                      isNew={now - (firstSeen.current.get(`${a.id}:${a.createdAt}`) ?? 0) < NEW_FOR_MS}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
