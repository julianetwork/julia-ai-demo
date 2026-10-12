import { test } from "node:test";
import assert from "node:assert/strict";
import { extractBooking, fromPostCallAnalysis, type TranscriptLine } from "../shared/booking.ts";

// Monday, 12 October 2026, mid-afternoon in Toronto.
const opts = { referenceDate: new Date("2026-10-12T18:00:00Z"), timeZone: "America/Toronto" };

const agent = (content: string): TranscriptLine => ({ role: "agent", content });
const user = (content: string): TranscriptLine => ({ role: "user", content });

const fullEnglishCall: TranscriptLine[] = [
  agent("Hi, I'm Julia, the AI receptionist for the shop. I can book appointments, answer questions about prices and hours, and take messages. How can I help you today?"),
  user("Hi, I'd like to book a haircut."),
  agent("Sure! May I have your name, please?"),
  user("It's Ahmed."),
  agent("Thanks, Ahmed. What day would you like to come in?"),
  user("Tomorrow if possible."),
  agent("And what time works best for you?"),
  user("Around 3 in the afternoon."),
  agent("Just to confirm: a haircut for Ahmed, tomorrow at 3 PM. Is that correct?"),
  user("Yes, that's right."),
  agent("Perfect, Ahmed, you're all set for tomorrow at 3 PM. We'll see you then!"),
];

test("confirms a complete English booking", () => {
  const r = extractBooking(fullEnglishCall, opts);
  assert.equal(r.status, "confirmed");
  if (r.status !== "confirmed") return;
  assert.equal(r.booking.customerName, "Ahmed");
  assert.equal(r.booking.dateISO, "2026-10-13");
  assert.equal(r.booking.time, "3:00 PM");
  assert.equal(r.booking.time24, "15:00");
  assert.equal(r.booking.service, "Haircut");
  assert.match(r.evidence, /all set/);
});

test("a call that ends before the final confirmation is not a booking", () => {
  const r = extractBooking(fullEnglishCall.slice(0, 10), opts);
  assert.deepEqual(r, { status: "not_confirmed", reason: "no_confirmation" });
});

test("a recap question is not a confirmation", () => {
  const r = extractBooking(fullEnglishCall.slice(0, 9), opts);
  assert.equal(r.status, "not_confirmed");
});

test("capability explanations and hypotheticals are ignored", () => {
  const r = extractBooking(
    [
      agent("Once a booking is confirmed, I can send the customer a reminder."),
      agent("Appointments are booked straight into your calendar, any day at 9 AM or 6 PM."),
      agent("If you're booked for Friday at 2 PM, I'll remind you the day before."),
      user("My name is Sam."),
    ],
    opts,
  );
  assert.equal(r.status, "not_confirmed");
});

test("negated confirmations are ignored", () => {
  const r = extractBooking(
    [user("I'm Dana, Friday at 2 PM please."), agent("I'm sorry, I couldn't book Friday at 2 PM, that slot is not confirmed yet.")],
    opts,
  );
  assert.equal(r.status, "not_confirmed");
});

test("missing details produce an honest incomplete result", () => {
  const r = extractBooking(
    [user("Can I get a fade tomorrow at 10 AM?"), agent("Great, you're booked for tomorrow at 10 AM.")],
    opts,
  );
  assert.equal(r.status, "incomplete");
  if (r.status !== "incomplete") return;
  assert.deepEqual(r.missing, ["name"]);
  assert.equal(r.partial.service, "Fade");
  assert.equal(r.partial.time, "10:00 AM");
});

test("the latest confirmation wins when the caller changes their mind", () => {
  const r = extractBooking(
    [
      ...fullEnglishCall,
      user("Actually, could we make it 4:30 instead?"),
      agent("No problem. I've updated it: Ahmed, tomorrow at 4:30 PM. You're all set!"),
    ],
    opts,
  );
  assert.equal(r.status, "confirmed");
  if (r.status === "confirmed") assert.equal(r.booking.time, "4:30 PM");
});

test("an agent cancellation after confirmation voids the booking", () => {
  const r = extractBooking(
    [...fullEnglishCall, user("Sorry, please cancel it."), agent("Okay, I've cancelled that appointment for you.")],
    opts,
  );
  assert.deepEqual(r, { status: "not_confirmed", reason: "cancelled" });
});

test("explicit calendar dates and minutes are parsed", () => {
  const r = extractBooking(
    [
      agent("What's your name?"),
      user("uh, it's jordan"),
      agent("Thanks Jordan. When would you like your beard trim?"),
      user("October 20th at 10:30 a.m."),
      agent("Your appointment is confirmed for Tuesday, October 20th at 10:30 AM."),
    ],
    opts,
  );
  assert.equal(r.status, "confirmed");
  if (r.status !== "confirmed") return;
  assert.equal(r.booking.customerName, "Jordan");
  assert.equal(r.booking.dateISO, "2026-10-20");
  assert.equal(r.booking.time, "10:30 AM");
  assert.equal(r.booking.service, "Beard trim");
});

test("confirms a French booking", () => {
  const r = extractBooking(
    [
      agent("Bonjour, ici Julia. Comment puis-je vous aider?"),
      user("Bonjour, je voudrais une coupe de cheveux."),
      agent("Avec plaisir. Quel est votre nom?"),
      user("Je m'appelle Marc Tremblay."),
      agent("Merci Marc. Quel jour vous conviendrait?"),
      user("Vendredi, vers 15 h."),
      agent("Parfait. Votre rendez-vous est confirmé pour Marc Tremblay, vendredi à 15 h 30. À bientôt!"),
    ],
    opts,
  );
  assert.equal(r.status, "confirmed");
  if (r.status !== "confirmed") return;
  assert.equal(r.booking.customerName, "Marc Tremblay");
  assert.equal(r.booking.dateISO, "2026-10-16");
  assert.equal(r.booking.time, "3:30 PM");
  assert.equal(r.booking.service, "Haircut");
});

test("word-number times and weekday names", () => {
  const r = extractBooking(
    [
      user("Hi, this is Priya Shah, I need a haircut next Thursday."),
      agent("Sure Priya, what time?"),
      user("Two o'clock."),
      agent("Great — I've booked Priya Shah for next Thursday at two o'clock."),
    ],
    opts,
  );
  assert.equal(r.status, "confirmed");
  if (r.status !== "confirmed") return;
  assert.equal(r.booking.customerName, "Priya Shah");
  assert.equal(r.booking.dateISO, "2026-10-15");
  assert.equal(r.booking.time, "2:00 PM");
});

test("empty transcripts are handled", () => {
  assert.deepEqual(extractBooking([], opts), { status: "not_confirmed", reason: "empty" });
});

test("structured post-call analysis is used when configured", () => {
  const r = fromPostCallAnalysis(
    { booking_confirmed: true, customer_name: "lee", appointment_date: "tomorrow", appointment_time: "11 AM" },
    opts,
  );
  assert.equal(r?.status, "confirmed");
  if (r?.status === "confirmed") {
    assert.equal(r.booking.customerName, "Lee");
    assert.equal(r.booking.dateISO, "2026-10-13");
    assert.equal(r.booking.time, "11:00 AM");
  }
  assert.equal(fromPostCallAnalysis({ booking_confirmed: false }, opts)?.status, "not_confirmed");
  assert.equal(fromPostCallAnalysis({ summary: "x" }, opts), null);
  assert.equal(fromPostCallAnalysis(undefined, opts), null);
});
