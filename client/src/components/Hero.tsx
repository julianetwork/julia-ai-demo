import { ArrowDownIcon, GlobeIcon, ClockIcon, CalendarIcon } from "./Icons.tsx";

export function Hero() {
  return (
    <section className="hero" id="top">
      <div className="hero__glow" aria-hidden="true" />
      <div className="container hero__inner">
        <p className="eyebrow">AI receptionist for barbershops</p>
        <h1 className="hero__title">
          Every call answered.
          <br />
          <span className="text-gradient">Every chair booked.</span>
        </h1>
        <p className="hero__lead">
          Julia picks up when you can't — mid-fade, after hours, on your busiest Saturday. She answers questions,
          books appointments and speaks with your customers in English or French, so you never lose a client to
          voicemail.
        </p>
        <div className="hero__actions">
          <a href="#demo" className="btn btn--primary btn--lg">
            Try a live call with Julia
          </a>
          <a href="#appointments" className="btn btn--ghost btn--lg">
            See the dashboard <ArrowDownIcon size={18} />
          </a>
        </div>
        <ul className="hero__facts" aria-label="Highlights">
          <li>
            <ClockIcon size={18} /> Answers 24/7, instantly
          </li>
          <li>
            <CalendarIcon size={18} /> Books while you cut
          </li>
          <li>
            <GlobeIcon size={18} /> English &amp; French
          </li>
        </ul>
      </div>
    </section>
  );
}
