import type { RefObject } from "react";
import type { OrbState } from "../lib/types.ts";
import { JuliaMark } from "./JuliaMark.tsx";

const LABELS: Record<OrbState, string> = {
  idle: "Ready to talk",
  connecting: "Connecting…",
  listening: "Listening",
  speaking: "Julia is speaking",
  ended: "Call ended",
  error: "Not connected",
};

/**
 * Julia's voice orb. State is expressed through brand colours and motion;
 * while Julia speaks, `--level` (0–1, set from the live audio analyser)
 * gently scales the inner glow.
 */
export function VoiceOrb({ state, orbRef }: { state: OrbState; orbRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div className={`orb orb--${state}`} ref={orbRef} role="img" aria-label={`Julia voice status: ${LABELS[state]}`}>
      <div className="orb__halo" aria-hidden="true" />
      <div className="orb__ring" aria-hidden="true" />
      <div className="orb__core" aria-hidden="true">
        <div className="orb__level" />
        <JuliaMark size={74} />
      </div>
    </div>
  );
}

export function orbLabel(state: OrbState) {
  return LABELS[state];
}
