import type { useVoiceCall } from "../hooks/useVoiceCall.ts";
import { VoiceOrb, orbLabel } from "./VoiceOrb.tsx";
import { CallControls } from "./CallControls.tsx";
import { LiveTranscript } from "./LiveTranscript.tsx";
import { CaptureStatus } from "./CaptureStatus.tsx";
import { AlertIcon, InfoIcon } from "./Icons.tsx";

type Call = ReturnType<typeof useVoiceCall>;

const STEPS = [
  { title: "Say hello", text: "Ask Julia what she can do for a barbershop." },
  { title: "Play the customer", text: "“Hi, I'd like to book a haircut.”" },
  { title: "Answer her questions", text: "Give a name, a day and a time — one at a time." },
  { title: "Confirm", text: "When Julia repeats it back, say yes. Watch the dashboard." },
];

export function VoiceDemo({ call }: { call: Call }) {
  const { phase, orbState, muted, error, endNote } = call;
  const live = phase === "live";

  return (
    <section className="section voice-demo" id="demo" aria-labelledby="demo-title">
      <div className="container">
        <div className="section__head">
          <p className="eyebrow">Live demo</p>
          <h2 id="demo-title" className="section__title">Talk to Julia — right now</h2>
          <p className="section__lead">
            This is a real voice conversation with Julia. Play a customer calling your shop and book a haircut; the
            appointment shows up in the dashboard below as soon as she confirms it.
          </p>
        </div>

        <div className="voice-demo__grid">
          <div className={`stage theme-dark ${live ? "stage--live" : ""}`}>
            <div className="stage__status">
              <span className={`status-pill status-pill--${orbState}`}>
                <span className="dot" aria-hidden="true" />
                {live ? (muted ? "Live · you're muted" : `Live · ${orbLabel(orbState).toLowerCase()}`) : orbLabel(orbState)}
              </span>
            </div>

            <VoiceOrb state={orbState} orbRef={call.orbRef} />

            <CallControls
              phase={phase}
              muted={muted}
              onStart={call.start}
              onEnd={call.end}
              onToggleMute={call.toggleMute}
            />

            {phase === "requesting_mic" && (
              <p className="stage__note" role="status">
                Your browser will ask for microphone access — choose <strong>Allow</strong> so Julia can hear you.
              </p>
            )}
            {phase === "idle" && (
              <p className="stage__note">
                Uses your microphone. Best with headphones in a quiet room. English or French.
              </p>
            )}

            {error && (
              <div className="alert alert--error" role="alert">
                <AlertIcon size={20} />
                <div>
                  <p className="alert__title">{error.title}</p>
                  <p className="alert__body">{error.message}</p>
                </div>
              </div>
            )}
            {endNote && !error && (
              <div className="alert alert--info" role="status">
                <InfoIcon size={20} />
                <p className="alert__body">{endNote}</p>
              </div>
            )}

            <p className="stage__privacy">
              Demo only — bookings are simulated, kept in this page's memory and never sent to a real calendar.
            </p>
          </div>

          <div className="voice-demo__side">
            <CaptureStatus outcome={call.outcome} />
            <LiveTranscript phase={phase} lines={call.transcript} state={call.transcriptState} />
            <section className="panel script" aria-labelledby="script-title">
              <h3 id="script-title" className="panel__title">Try this script</h3>
              <ol className="script__steps">
                {STEPS.map((s, i) => (
                  <li key={s.title}>
                    <span className="script__num" aria-hidden="true">{i + 1}</span>
                    <div>
                      <p className="script__title">{s.title}</p>
                      <p className="script__text">{s.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}
