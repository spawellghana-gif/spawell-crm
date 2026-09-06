import type { ReactNode } from "react";
import {
  STATUS_LABEL, STATUS_TONE, ENQUIRY_LABEL, ENQUIRY_TONE,
  type BookingStatus, type EnquiryStatus,
} from "@/lib/types";

export function Chip({ tone, children }: { tone?: string; children: ReactNode }) {
  return <span className={`chip ${tone ?? ""}`}>{children}</span>;
}

export function BookingChip({ status }: { status: BookingStatus }) {
  return (
    <span className={`chip ${STATUS_TONE[status]}`}>
      <i className="dot" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function EnquiryChip({ status }: { status: EnquiryStatus }) {
  return (
    <span className={`chip ${ENQUIRY_TONE[status]}`}>
      <i className="dot" />
      {ENQUIRY_LABEL[status]}
    </span>
  );
}

export function Card({
  title, action, children, pad = true,
}: { title?: string; action?: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <section className="card">
      {title && (
        <header>
          <h3>{title}</h3>
          {action && <span className="sp">{action}</span>}
        </header>
      )}
      {pad ? <div className="body">{children}</div> : children}
    </section>
  );
}

export function Kpi({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="lab">{label}</div>
      <div className="v">{value}</div>
      {detail && <div className="d">{detail}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Field({
  label, children, hint, name,
}: { label: string; children: ReactNode; hint?: string; name?: string }) {
  return (
    <div>
      <label className="f" htmlFor={name}>{label}</label>
      {children}
      {hint && <div className="note" style={{ marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

export function PageHead({
  title, blurb, actions,
}: { title: string; blurb?: string; actions?: ReactNode }) {
  return (
    <div className="pagehead">
      <div>
        <h2>{title}</h2>
        {blurb && <p>{blurb}</p>}
      </div>
      {actions && <div className="sp">{actions}</div>}
    </div>
  );
}

/** Shown when an action fails, e.g. a database policy refused the write. */
export function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="alert bad" style={{ marginBottom: 12 }}>
      <span aria-hidden="true">⚠</span>
      <span>{message}</span>
    </div>
  );
}
