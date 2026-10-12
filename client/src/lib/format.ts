const dateFmt = new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const longDateFmt = new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/** Formats a YYYY-MM-DD calendar date without time-zone drift. */
export function formatDate(iso: string | null, fallback: string, long = false): string {
  if (!iso) return capitalize(fallback);
  const [y, m, d] = iso.split("-").map(Number);
  return (long ? longDateFmt : dateFmt).format(new Date(Date.UTC(y, m - 1, d)));
}

export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function listFields(fields: string[]): string {
  if (fields.length <= 1) return fields.join("");
  return `${fields.slice(0, -1).join(", ")} and ${fields.at(-1)}`;
}
