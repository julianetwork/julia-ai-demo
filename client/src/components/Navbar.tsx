import { JuliaLogo } from "./JuliaMark.tsx";

export function Navbar() {
  return (
    <header className="navbar">
      <div className="container navbar__inner">
        <a href="#top" className="navbar__brand" aria-label="Julia AI home">
          <JuliaLogo />
        </a>
        <nav aria-label="Main" className="navbar__links">
          <a href="#demo">Live demo</a>
          <a href="#appointments">Appointments</a>
          <a href="#capabilities">What Julia does</a>
        </nav>
        <a href="#demo" className="btn btn--primary btn--sm navbar__cta">
          Talk to Julia
        </a>
      </div>
    </header>
  );
}
