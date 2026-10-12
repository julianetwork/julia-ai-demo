import { CalendarIcon, ClockIcon, GlobeIcon, MessageIcon, PhoneIcon, ShieldIcon } from "./Icons.tsx";

const ITEMS = [
  { icon: PhoneIcon, title: "Answers every call", text: "Picks up instantly, day or night — even when every chair is full." },
  { icon: CalendarIcon, title: "Books appointments", text: "Collects name, service, day and time, then confirms it back to the caller." },
  { icon: MessageIcon, title: "Handles the questions", text: "Prices, hours, location, walk-ins, parking — answered the way you would." },
  { icon: GlobeIcon, title: "English & French", text: "Speaks naturally with your customers in the language they're comfortable with." },
  { icon: ClockIcon, title: "Saves your time", text: "No more stopping mid-cut to grab the phone or call back missed numbers." },
  { icon: ShieldIcon, title: "Built for Canadian shops", text: "Professional, polite and on-brand for your business, every single call." },
];

export function Capabilities() {
  return (
    <section className="section capabilities" id="capabilities" aria-labelledby="cap-title">
      <div className="container">
        <div className="section__head">
          <p className="eyebrow">What Julia does</p>
          <h2 id="cap-title" className="section__title">A front desk that never puts anyone on hold</h2>
        </div>
        <ul className="cap-grid">
          {ITEMS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="cap-card">
              <span className="cap-card__icon"><Icon size={22} /></span>
              <h3 className="cap-card__title">{title}</h3>
              <p className="cap-card__text">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
