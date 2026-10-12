import { randomUUID } from "node:crypto";
import type { Response } from "express";
import type { DemoAppointment, SchedulerActivity, SessionEvent } from "../shared/api.ts";
import { log } from "./logger.ts";

/**
 * Demo sessions: one per open page. Each holds that visitor's confirmed demo
 * appointments in server memory only — never written to disk or a database.
 * Refreshing the page starts a new, empty session; Reset Demo empties it;
 * abandoned sessions expire.
 */

const MAX_SESSIONS = 500;
const MAX_APPOINTMENTS = 60;
const MAX_ACTIVITY = 40;
const IDLE_TTL_MS = 30 * 60 * 1000;
const EPHEMERAL_TTL_MS = 2 * 60 * 60 * 1000;

export class DemoSession {
  readonly id: string;
  readonly createdAt = Date.now();
  lastSeen = Date.now();
  appointments: DemoAppointment[] = [];
  activity: SchedulerActivity[] = [];
  private subscribers = new Set<Response>();

  /** Ephemeral sessions back calls not started from a demo page (e.g. Retell's own test console). */
  constructor(readonly ephemeral = false, id?: string) {
    this.id = id ?? randomUUID();
  }

  get full() {
    return this.appointments.length >= MAX_APPOINTMENTS;
  }

  subscribe(res: Response) {
    this.subscribers.add(res);
    this.touch();
    send(res, { type: "appointments", appointments: this.appointments });
    send(res, { type: "activity_log", entries: this.activity });
  }

  unsubscribe(res: Response) {
    this.subscribers.delete(res);
    this.touch();
  }

  get watched() {
    return this.subscribers.size > 0;
  }

  touch() {
    this.lastSeen = Date.now();
  }

  setAppointments(next: DemoAppointment[]) {
    this.appointments = [...next].sort((a, b) =>
      a.dateISO === b.dateISO ? a.startMinutes - b.startMinutes : a.dateISO < b.dateISO ? -1 : 1,
    );
    this.touch();
    this.broadcast({ type: "appointments", appointments: this.appointments });
  }

  record(entry: Omit<SchedulerActivity, "id" | "at">) {
    const full: SchedulerActivity = { ...entry, id: randomUUID(), at: Date.now() };
    this.activity = [...this.activity, full].slice(-MAX_ACTIVITY);
    this.broadcast({ type: "activity", entry: full });
  }

  reset() {
    this.activity = [];
    this.setAppointments([]);
    this.broadcast({ type: "activity_log", entries: [] });
  }

  close() {
    for (const res of this.subscribers) res.end();
    this.subscribers.clear();
  }

  private broadcast(ev: SessionEvent) {
    for (const res of this.subscribers) send(res, ev);
  }
}

function send(res: Response, ev: SessionEvent) {
  res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
}

const sessions = new Map<string, DemoSession>();

export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createSession(): DemoSession {
  if (sessions.size >= MAX_SESSIONS) {
    // Evict the least recently active unwatched session.
    const victim = [...sessions.values()].filter((s) => !s.watched).sort((a, b) => a.lastSeen - b.lastSeen)[0];
    if (victim) {
      victim.close();
      sessions.delete(victim.id);
    }
  }
  const session = new DemoSession();
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): DemoSession | undefined {
  return SESSION_ID_PATTERN.test(id) ? sessions.get(id) : undefined;
}

/** Scratch session for a call that has no demo page behind it, so checks stay consistent within that call. */
export function ephemeralSessionForCall(callId: string): DemoSession {
  const key = `call:${callId}`;
  let s = sessions.get(key);
  if (!s) {
    s = new DemoSession(true, key);
    sessions.set(key, s);
  }
  return s;
}

export function callHasBooking(sessionId: string | undefined, callId: string): boolean {
  const s = sessionId ? sessions.get(sessionId) : sessions.get(`call:${callId}`);
  return !!s?.appointments.some((a) => a.callId === callId);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    const ttl = s.ephemeral ? EPHEMERAL_TTL_MS : IDLE_TTL_MS;
    if (!s.watched && now - s.lastSeen > ttl) {
      s.close();
      sessions.delete(id);
    }
  }
}, 60_000).unref();

export function sessionCount() {
  return sessions.size;
}

export function disposeAllSessions() {
  for (const s of sessions.values()) s.close();
  sessions.clear();
  log.info("sessions", "cleared all demo sessions");
}
