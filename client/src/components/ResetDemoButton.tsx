import { ResetIcon } from "./Icons.tsx";

export function ResetDemoButton({ onReset, disabled }: { onReset: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="btn btn--outline-dark" onClick={onReset} disabled={disabled}>
      <ResetIcon size={18} />
      Reset Demo
    </button>
  );
}
