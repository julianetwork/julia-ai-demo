import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "../../../shared/api.ts";
import type { CallPhase, TranscriptState } from "../lib/types.ts";

interface Props {
  phase: CallPhase;
  lines: TranscriptEntry[];
  state: TranscriptState;
}

export function LiveTranscript({ phase, lines, state }: Props) {
  const scroller = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  let hint: string | null = null;
  if (!lines.length) {
    if (phase === "idle" || phase === "error") hint = "The conversation will appear here once you start talking with Julia.";
    else if (state === "unavailable")
      hint = "Live transcript isn't available for this call. Julia can still hear you — the booking will be verified from Retell's call record when the call ends.";
    else if (phase === "live") hint = "Say hello — Julia is listening.";
    else if (phase === "requesting_mic" || phase === "connecting") hint = "Connecting to Julia…";
    else hint = "No transcript was captured for this call.";
  }

  return (
    <section className="panel transcript" aria-labelledby="transcript-title">
      <header className="panel__header">
        <h3 id="transcript-title" className="panel__title">Live transcript</h3>
        {state === "connected" && phase === "live" && (
          <span className="chip chip--live">
            <span className="dot" aria-hidden="true" /> Live
          </span>
        )}
      </header>
      {hint ? (
        <p className="transcript__hint">{hint}</p>
      ) : (
        <ol className="transcript__list" ref={scroller} aria-live="polite" aria-relevant="additions">
          {lines.map((l) => (
            <li key={l.id} className={`bubble bubble--${l.role}`}>
              <span className="bubble__who">{l.role === "agent" ? "Julia" : "You"}</span>
              <span className="bubble__text">{l.content}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
