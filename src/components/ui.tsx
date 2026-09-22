import type { ReactNode } from "react";
import type { Priority, Verdict } from "../scheduler/types";
import { PRIORITY_LABEL, VERDICT_LABEL } from "../scheduler/rules";

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`badge badge-prio-${priority}`}>{PRIORITY_LABEL[priority]}</span>;
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <span className={`badge badge-verdict-${verdict}`}>{VERDICT_LABEL[verdict]}</span>;
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
      {hint ? <em className="field-hint">{hint}</em> : null}
    </label>
  );
}
