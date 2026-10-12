import { JuliaLogo } from "./JuliaMark.tsx";

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__inner">
        <JuliaLogo />
        <p className="footer__text">
          Interactive demo. Voice powered by Retell AI. Bookings shown here are simulated and are not stored.
        </p>
      </div>
    </footer>
  );
}
