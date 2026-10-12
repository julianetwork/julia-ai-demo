import { useEffect, useMemo, useState } from "react";
import type { Appointment } from "../lib/types.ts";
import { formatDate, todayISO } from "../lib/format.ts";
import { AppointmentRow } from "./AppointmentRow.tsx";
import { ResetDemoButton } from "./ResetDemoButton.tsx";
import { CalendarIcon, ClockIcon, InfoIcon, ScissorsIcon, UsersIcon } from "./Icons.tsx";

interface Props {
  appointments: Appointment[];
  onReset: () => void;
}

export function AppointmentsDashboard({ appointments, onReset }: Props) {
  // Re-render every 30 s so "New" badges expire and "Today" stays correct.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => setNow(Date.now()), [appointments]);

  const today = todayISO();
  const stats = useMemo(() => {
    const active = appointments.filter((a) => a.status !== "needs_review");
    const todays = active.filter((a) => a.dateISO === today);
    const upcoming = active
      .filter((a) => a.dateISO && a.dateISO >= today)
      .sort((x, y) => `${x.dateISO}${x.time24}`.localeCompare(`${y.dateISO}${y.time24}`));
    return { total: appointments.length, today: todays.length, next: upcoming[0] ?? null, review: appointments.length - active.length };
  }, [appointments, today]);

  const latest = appointments[0];

  return (
    <section className="section dashboard-section" id="appointments" aria-labelledby="appointments-title">
      <div className="container">
        <div className="dashboard">
          <header className="dashboard__header">
            <div>
              <p className="dashboard__shop">
                <ScissorsIcon size={16} /> Demo Barbershop · Front desk
              </p>
              <h2 id="appointments-title" className="dashboard__title">Appointments</h2>
            </div>
            <ResetDemoButton onReset={onReset} />
          </header>

          <p className="dashboard__notice">
            <InfoIcon size={16} />
            Simulated demo data for this page session only — nothing is saved, sent or added to a real calendar.
            Refreshing the page clears it.
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
                {stats.next ? `${stats.next.customerName} · ${formatDate(stats.next.dateISO, stats.next.dateLabel)}, ${stats.next.time}` : "—"}
              </span>
            </div>
            <div className="stat stat--brand" role="listitem">
              <span className="stat__icon"><ScissorsIcon size={18} /></span>
              <span className="stat__label">Booked by Julia</span>
              <span className="stat__value">{stats.total - stats.review}</span>
            </div>
          </div>

          {/* Announces new bookings to screen-reader users. */}
          <p className="sr-only" aria-live="polite">
            {latest ? `New appointment: ${latest.customerName}, ${formatDate(latest.dateISO, latest.dateLabel, true)} at ${latest.time}.` : ""}
          </p>

          {appointments.length === 0 ? (
            <div className="empty">
              <div className="empty__art" aria-hidden="true">
                <CalendarIcon size={30} />
              </div>
              <h3 className="empty__title">No appointments yet</h3>
              <p className="empty__text">
                Start a conversation with Julia and book a haircut as if you were a customer. The moment she confirms
                it, the appointment appears here — no refresh needed.
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
                    <AppointmentRow key={a.id} appointment={a} now={now} />
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
