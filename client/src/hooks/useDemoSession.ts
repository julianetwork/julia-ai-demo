import { useCallback, useEffect, useRef, useState } from "react";
import type { DemoAppointment, DemoSessionInfo, SchedulerActivity, SessionEvent } from "../../../shared/api.ts";

export type SessionStatus = "starting" | "ready" | "reconnecting" | "error";

/**
 * The page's demo session. The server's scheduler owns the appointments (it
 * validates every booking Julia makes); this hook mirrors them live over SSE.
 * Nothing is stored in the browser: a refresh creates a brand-new, empty
 * session, and Reset Demo empties the current one.
 */
export function useDemoSession() {
  const [info, setInfo] = useState<DemoSessionInfo | null>(null);
  const [status, setStatus] = useState<SessionStatus>("starting");
  const [appointments, setAppointments] = useState<DemoAppointment[]>([]);
  const [activity, setActivity] = useState<SchedulerActivity[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const infoRef = useRef<DemoSessionInfo | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const alive = useRef(true);
  const creating = useRef<Promise<DemoSessionInfo | null> | null>(null);

  const connect = useCallback((session: DemoSessionInfo) => {
    esRef.current?.close();
    const es = new EventSource(`/api/demo-sessions/${session.id}/events`);
    esRef.current = es;
    const on = <T extends SessionEvent["type"]>(type: T, fn: (ev: Extract<SessionEvent, { type: T }>) => void) =>
      es.addEventListener(type, (e) => {
        if (esRef.current !== es) return;
        try {
          fn(JSON.parse((e as MessageEvent).data));
        } catch {
          /* ignore malformed frames */
        }
      });
    on("appointments", (ev) => setAppointments(ev.appointments));
    on("activity_log", (ev) => setActivity(ev.entries));
    on("activity", (ev) => setActivity((list) => [...list, ev.entry].slice(-40)));
    es.onopen = () => setStatus("ready");
    es.onerror = () => {
      if (esRef.current !== es) return;
      setStatus("reconnecting");
      // The server may have restarted (e.g. a sleeping free-tier host): its sessions are gone.
      fetch(`/api/demo-sessions/${session.id}`)
        .then((r) => {
          if (r.status === 404 && esRef.current === es && alive.current) {
            es.close();
            setNotice("The demo server restarted, so the dashboard was cleared.");
            void create();
          }
        })
        .catch(() => {});
    };
  }, []);

  const create = useCallback((): Promise<DemoSessionInfo | null> => {
    creating.current ??= fetch("/api/demo-sessions", { method: "POST" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const session = (await r.json()) as DemoSessionInfo;
        if (!alive.current) return null;
        infoRef.current = session;
        setInfo(session);
        setAppointments([]);
        setActivity([]);
        connect(session);
        return session;
      })
      .catch(() => {
        if (alive.current) setStatus("error");
        return null;
      })
      .finally(() => {
        creating.current = null;
      });
    return creating.current;
  }, [connect]);

  useEffect(() => {
    alive.current = true;
    void create();
    return () => {
      alive.current = false;
      esRef.current?.close();
      esRef.current = null;
    };
  }, [create]);

  /** Returns a usable session id, creating a new session if the old one is gone. */
  const ensureSessionId = useCallback(async (): Promise<string | null> => {
    const current = infoRef.current;
    if (current) {
      const r = await fetch(`/api/demo-sessions/${current.id}`).catch(() => null);
      if (r?.ok) return current.id;
      if (r?.status !== 404) return current.id;
    }
    return (await create())?.id ?? null;
  }, [create]);

  /** Reset Demo: empties this session's calendar so every slot is free again. */
  const reset = useCallback(async () => {
    setAppointments([]);
    setActivity([]);
    setNotice(null);
    const current = infoRef.current;
    if (!current) return;
    const r = await fetch(`/api/demo-sessions/${current.id}/reset`, { method: "POST" }).catch(() => null);
    if (r?.status === 404) await create();
  }, [create]);

  return { info, status, appointments, activity, notice, dismissNotice: () => setNotice(null), ensureSessionId, reset };
}
