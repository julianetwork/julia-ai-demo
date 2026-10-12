import { useCallback } from "react";
import { Navbar } from "./components/Navbar.tsx";
import { Hero } from "./components/Hero.tsx";
import { VoiceDemo } from "./components/VoiceDemo.tsx";
import { AppointmentsDashboard } from "./components/AppointmentsDashboard.tsx";
import { Capabilities } from "./components/Capabilities.tsx";
import { Footer } from "./components/Footer.tsx";
import { useDemoSession } from "./hooks/useDemoSession.ts";
import { useVoiceCall } from "./hooks/useVoiceCall.ts";

export function App() {
  const demo = useDemoSession();
  const call = useVoiceCall({ getSessionId: demo.ensureSessionId });

  const { reset: resetCall } = call;
  const { reset: resetSession } = demo;
  const resetDemo = useCallback(() => {
    resetCall();
    void resetSession();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("demo")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [resetCall, resetSession]);

  return (
    <>
      <a className="skip-link" href="#demo">Skip to the live demo</a>
      <Navbar />
      <main>
        <Hero />
        <VoiceDemo call={call} activity={demo.activity} appointments={demo.appointments} />
        <AppointmentsDashboard
          appointments={demo.appointments}
          session={demo.info}
          notice={demo.notice}
          onReset={resetDemo}
        />
        <Capabilities />
      </main>
      <Footer />
    </>
  );
}
