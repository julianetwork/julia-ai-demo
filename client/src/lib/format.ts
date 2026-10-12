const dateFmt = new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const longDateFmt = new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/** Formats a YYYY-MM-DD calendar date without time-zone drift. */
export function formatDate(iso: string | null, fallback: string, long = false): string {
  if (!iso) return fallback;
  const [y, m, d] = iso.split("-").map(Number);
  return (long ? longDateFmt : dateFmt).format(new Date(Date.UTC(y, m - 1, d)));
}
