import type { DemoAppointment } from "../../../shared/api.ts";
import { formatSlotRange } from "../../../shared/scheduling.ts";
import { formatDate } from "../lib/format.ts";

export function AppointmentRow({ appointment: a, isNew }: { appointment: DemoAppointment; isNew: boolean }) {
  return (
    <tr className={`appt-row ${isNew ? "appt-row--new" : ""}`}>
      <td data-label="Customer">
        <span className="appt-row__name">{a.customerName}</span>
        {isNew && <span className="badge badge--new">New</span>}
      </td>
      <td data-label="Service">{a.service}</td>
      <td data-label="Date">{formatDate(a.dateISO, a.dateISO)}</td>
      <td data-label="Time" className="tabular">
        {formatSlotRange(a)}
        <span className="status__sub">60 min</span>
      </td>
      <td data-label="Status">
        <span className="status status--verified" title="Accepted by the scheduler: no overlap with any other appointment.">
          <span className="dot" aria-hidden="true" />
          Confirmed
        </span>
        <span className="status__sub">Slot validated</span>
      </td>
      <td data-label="Source">
        <span className="source">Julia AI · Voice demo</span>
        <span className="status__sub">Demo booking</span>
      </td>
    </tr>
  );
}
