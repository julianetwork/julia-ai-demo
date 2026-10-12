import type { CallPhase } from "../lib/types.ts";
import { MicIcon, MicOffIcon, PhoneIcon, PhoneOffIcon } from "./Icons.tsx";

interface Props {
  phase: CallPhase;
  muted: boolean;
  onStart: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
}

export function CallControls({ phase, muted, onStart, onEnd, onToggleMute }: Props) {
  const inCall = phase === "live" || phase === "ending";
  const busy = phase === "requesting_mic" || phase === "connecting";

  if (!inCall && !busy) {
    const again = phase === "ended" || phase === "error";
    return (
      <div className="call-controls">
        <button type="button" className="btn btn--primary btn--lg btn--call" onClick={onStart}>
          <PhoneIcon size={20} />
          {again ? "Start a new conversation" : "Start Conversation"}
        </button>
      </div>
    );
  }

  return (
    <div className="call-controls">
      <button
        type="button"
        className={`btn btn--icon ${muted ? "is-active" : ""}`}
        onClick={onToggleMute}
        disabled={phase !== "live"}
        aria-pressed={muted}
        aria-label={muted ? "Unmute microphone" : "Mute microphone"}
        title={muted ? "Unmute" : "Mute"}
      >
        {muted ? <MicOffIcon size={22} /> : <MicIcon size={22} />}
      </button>
      <button
        type="button"
        className="btn btn--end btn--lg"
        onClick={onEnd}
        disabled={phase === "ending" || busy}
        aria-busy={busy || phase === "ending"}
      >
        <PhoneOffIcon size={20} />
        {busy ? (phase === "requesting_mic" ? "Waiting for microphone…" : "Connecting…") : phase === "ending" ? "Ending…" : "End Conversation"}
      </button>
    </div>
  );
}
