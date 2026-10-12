import { useCallback } from "react";
import { Navbar } from "./components/Navbar.tsx";
import { Hero } from "./components/Hero.tsx";
import { VoiceDemo } from "./components/VoiceDemo.tsx";
import { AppointmentsDashboard } from "./components/AppointmentsDashboard.tsx";
import { Capabilities } from "./components/Capabilities.tsx";
import { Footer } from "./components/Footer.tsx";
import { useAppointments } from "./hooks/useAppointments.ts";
import { useVoiceCall } from "./hooks/useVoiceCall.ts";

export function App() {
  const appointments = useAppointments();
  const call = useVoiceCall({
    onBookingCaptured: appointments.capture,
    onBookingNeedsReview: appointments.flagForReview,
    onBookingCancelled: appointments.remove,
  });

  const { reset: resetCall } = call;
  const { reset: resetAppointments } = appointments;
  const resetDemo = useCallback(() => {
    resetCall();
    resetAppointments();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("demo")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [resetCall, resetAppointments]);

  return (
    <>
      <a className="skip-link" href="#demo">Skip to the live demo</a>
      <Navbar />
      <main>
        <Hero />
        <VoiceDemo call={call} />
        <AppointmentsDashboard appointments={appointments.appointments} onReset={resetDemo} />
        <Capabilities />
      </main>
      <Footer />
    </>
  );
}
