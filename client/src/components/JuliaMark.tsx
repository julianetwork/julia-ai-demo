import { useId } from "react";

/** Julia's ghost mark, redrawn as SVG in the brand palette. */
export function JuliaMark({ size = 32, face = true }: { size?: number; face?: boolean }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="julia-mark">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-cyan)" />
          <stop offset="1" stopColor="var(--color-deep-blue)" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${id})`}
        d="M34 6c13 0 22 9.5 22 22 0 15-11.5 28-27 30-5 .7-9.5-.6-12.5-3.4-1.6-1.5-1-3.8.9-4.6 2-.8 2.4-2.6 1-4.2C13.5 40.8 12 36 12 30 12 16.5 21 6 34 6Z"
      />
      {face && (
        <g stroke="var(--color-off-white)" strokeWidth="2.6" strokeLinecap="round" fill="none">
          <circle cx="29" cy="27" r="3.2" fill="var(--color-off-white)" stroke="none" />
          <path d="M38 26.5c1.2-1.6 3.6-1.6 4.8 0" />
          <path d="M29 37c3.5 3 8.5 3 12-.5" />
        </g>
      )}
      <circle cx="8" cy="40" r="3.4" fill="var(--color-cyan)" />
    </svg>
  );
}

export function JuliaLogo() {
  return (
    <span className="logo">
      <JuliaMark size={34} />
      <span className="logo__word">Julia AI</span>
    </span>
  );
}
