import { Card } from "@/components/ui";
import { deleteRecord } from "@/app/(app)/admin-actions";

/**
 * The delete control, kept deliberately awkward.
 *
 * Deleting is irreversible and the person doing it is usually in a hurry, so
 * the friction is the feature: the owner types DELETE, and the server checks
 * that word before touching anything.
 */
export function DangerZone({
  table, id, label, from, children, warning,
}: {
  table: string;
  id: string;
  label: string;
  /** Where to return on failure — the page the button lives on. */
  from: string;
  /** What this delete takes with it, in the owner's terms. */
  children?: React.ReactNode;
  /** Shown in red when there is a specific reason to stop and think. */
  warning?: string;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <Card title={`Delete this ${label}`}>
        <p className="note" style={{ marginTop: 0 }}>
          {children ?? `This removes the ${label} permanently. It cannot be undone.`}
          {" "}The deletion itself is written to the audit log, including the
          record as it was, so there is always evidence of what went and who
          removed it.
        </p>
        {warning && (
          <p className="note" style={{ color: "var(--bad)", fontWeight: 600 }}>{warning}</p>
        )}
        <form action={deleteRecord} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input type="hidden" name="table" value={table} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="from" value={from} />
          <input
            className="inp mono"
            name="confirm"
            required
            autoComplete="off"
            placeholder="Type DELETE"
            aria-label={`Type DELETE to confirm removing this ${label}`}
            style={{ maxWidth: 160 }}
          />
          <button className="btn" type="submit" style={{ color: "var(--bad)", fontWeight: 600 }}>
            Delete {label}
          </button>
        </form>
      </Card>
    </div>
  );
}

/** The compact form, for a row in a table rather than a whole record page. */
export function DeleteRowButton({
  table, id, from, label = "row",
}: { table: string; id: string; from: string; label?: string }) {
  return (
    <form action={deleteRecord} className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="from" value={from} />
      <input
        className="inp mono"
        name="confirm"
        required
        autoComplete="off"
        placeholder="DELETE"
        aria-label={`Type DELETE to remove this ${label}`}
        style={{ maxWidth: 92, fontSize: 11.5, padding: "4px 6px" }}
      />
      <button className="btn" type="submit" style={{ color: "var(--bad)", padding: "4px 8px" }}>
        Delete
      </button>
    </form>
  );
}
