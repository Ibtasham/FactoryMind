import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Info, X } from 'lucide-react';
import { StockStatus } from '../../engine/ipe';
import { DatasetProvenance, MODEL_ASSUMPTIONS } from '../../engine/uxHelpers';
import { ToastMessage } from '../../store/StoreContext';

export const Panel: React.FC<{
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, actions, children, className = '' }) => (
  <section
    className={`rounded-xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-slate-900/85 shadow-xs transition-colors ${className}`}
  >
    {(title || actions) && (
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800/80">
        <div className="min-w-0">
          {title && <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>}
          {subtitle && <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
    )}
    <div className="p-4">{children}</div>
  </section>
);

export const StatCard: React.FC<{
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}> = ({ label, value, sub, tone = 'neutral' }) => {
  const toneCls =
    tone === 'good'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-700 dark:text-amber-400'
        : tone === 'bad'
          ? 'text-rose-700 dark:text-rose-400'
          : 'text-slate-600 dark:text-slate-300';

  return (
    <div className="rounded-xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-slate-900/85 px-4 py-3.5 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
      <div className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</div>
      <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-50">
        {value}
      </div>
      {sub && <div className={`mt-1 text-xs font-mono tabular-nums ${toneCls}`}>{sub}</div>}
    </div>
  );
};

export const StatusLabel: React.FC<{ status: StockStatus }> = ({ status }) => {
  const map: Record<StockStatus, { label: string; cls: string }> = {
    ok: { label: 'Healthy', cls: 'text-emerald-700 dark:text-emerald-400' },
    reorder: { label: 'Reorder', cls: 'text-amber-700 dark:text-amber-400' },
    critical: { label: 'Low stock', cls: 'text-rose-700 dark:text-rose-400' },
    out: { label: 'Stockout', cls: 'text-rose-700 dark:text-rose-400 font-semibold' },
  };
  const m = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${m.cls}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {m.label}
    </span>
  );
};

export const SegmentedControl: React.FC<{
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
  ariaLabel?: string;
}> = ({ options, value, onChange, ariaLabel }) => (
  <div
    role="tablist"
    aria-label={ariaLabel}
    className="inline-flex flex-wrap rounded-md border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-950/60 p-0.5"
  >
    {options.map((opt) => {
      const active = opt.value === value;
      return (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 text-xs font-medium rounded-[4px] transition-colors cursor-pointer ${
            active
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md';
  }
> = ({ variant = 'secondary', size = 'md', className = '', children, ...props }) => {
  const base =
    'inline-flex items-center justify-center gap-1.5 font-medium rounded-md transition-colors disabled:opacity-45 disabled:pointer-events-none cursor-pointer';
  const sz = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-xs';
  const vr =
    variant === 'primary'
      ? 'text-white bg-[var(--accent)] hover:opacity-90'
      : variant === 'danger'
        ? 'text-white bg-rose-600 hover:bg-rose-500'
        : variant === 'ghost'
          ? 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
          : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800';
  return (
    <button className={`${base} ${sz} ${vr} ${className}`} {...props}>
      {children}
    </button>
  );
};

export const Field: React.FC<{
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
}> = ({ label, hint, error, htmlFor, children }) => {
  const autoId = useId();
  const fieldId = htmlFor || `field-${autoId}`;
  const errorId = `${fieldId}-error`;
  return (
    <div className="space-y-1">
      <label htmlFor={fieldId} className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-700 dark:text-slate-200">{label}</span>
        {hint && <span className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>}
      </label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            id: (children.props as Record<string, unknown>).id || fieldId,
            'aria-invalid': error ? true : (children.props as Record<string, unknown>)['aria-invalid'],
            'aria-describedby': error
              ? errorId
              : (children.props as Record<string, unknown>)['aria-describedby'],
          })
        : children}
      {error && (
        <p id={errorId} role="alert" className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
};

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({ className = '', ...props }) => {
  const hasErr = Boolean(props['aria-invalid']);
  return (
    <input
      className={`w-full rounded-md border ${
        hasErr
          ? 'border-rose-500 dark:border-rose-400 focus:ring-rose-500/35'
          : 'border-slate-200 dark:border-slate-700 focus:ring-[var(--accent)]/40'
      } bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 font-mono tabular-nums focus:outline-none focus:ring-2 ${className}`}
      {...props}
    />
  );
};

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ className = '', ...props }) => {
  const hasErr = Boolean(props['aria-invalid']);
  return (
    <select
      className={`w-full rounded-md border ${
        hasErr
          ? 'border-rose-500 dark:border-rose-400 focus:ring-rose-500/35'
          : 'border-slate-200 dark:border-slate-700 focus:ring-[var(--accent)]/40'
      } bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 ${className}`}
      {...props}
    />
  );
};

export const EmptyState: React.FC<{ title: string; message: string; action?: React.ReactNode }> = ({
  title,
  message,
  action,
}) => (
  <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</div>
    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 max-w-md mx-auto">{message}</p>
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const ErrorBanner: React.FC<{
  title?: string;
  message: string;
  action?: React.ReactNode;
}> = ({ title = 'Unable to compute result', message, action }) => (
  <div
    role="alert"
    className="rounded-lg border border-rose-300/80 dark:border-rose-800/80 bg-rose-50/70 dark:bg-rose-950/35 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
  >
    <div className="flex items-start gap-2.5 min-w-0">
      <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="text-xs font-semibold text-rose-800 dark:text-rose-300">{title}</div>
        <p className="text-xs text-rose-700 dark:text-rose-300/90 mt-0.5">{message}</p>
      </div>
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);

export const ModuleSkeleton: React.FC<{ label?: string }> = ({ label = 'Loading engineering module…' }) => (
  <div role="status" aria-label={label} className="space-y-4">
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4">
      <div className="h-4 w-48 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
      <div className="h-3 w-72 max-w-full rounded bg-slate-100 dark:bg-slate-800/70 mt-2 animate-pulse" />
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
      {[0, 1, 2, 3].map((k) => (
        <div
          key={k}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4 space-y-2"
        >
          <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
          <div className="h-6 w-32 rounded bg-slate-100 dark:bg-slate-800/70 animate-pulse" />
        </div>
      ))}
    </div>
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-6">
      <div className="h-44 w-full rounded bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
      <div className="mt-3 text-xs font-mono text-slate-600 dark:text-slate-300">{label}</div>
    </div>
  </div>
);

export const DatasetProvenanceIndicator: React.FC<{
  provenance: DatasetProvenance;
  onManage?: () => void;
}> = ({ provenance, onManage }) => {
  const toneCls =
    provenance.kind === 'demo'
      ? 'text-blue-700 dark:text-blue-400'
      : provenance.kind === 'modified-demo'
        ? 'text-amber-700 dark:text-amber-400'
        : provenance.kind === 'custom'
          ? 'text-emerald-700 dark:text-emerald-400'
          : 'text-slate-600 dark:text-slate-300';

  return (
    <div
      data-testid="dataset-provenance-banner"
      className="rounded-lg border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-slate-900/85 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
        <span className={`font-semibold ${toneCls}`}>{provenance.label}</span>
        <span aria-hidden="true" className="text-slate-400">·</span>
        <span className="text-slate-600 dark:text-slate-300">{provenance.summary}</span>
      </div>
      {onManage && (
        <button
          type="button"
          onClick={onManage}
          className="text-xs font-medium text-[var(--accent)] hover:underline cursor-pointer shrink-0"
        >
          Import / Reset data
        </button>
      )}
    </div>
  );
};

export const AssumptionPanel: React.FC<{
  topicId: keyof typeof MODEL_ASSUMPTIONS | string;
  defaultOpen?: boolean;
}> = ({ topicId, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  const spec = MODEL_ASSUMPTIONS[topicId];
  if (!spec) return null;

  return (
    <section
      aria-label={`Model assumptions for ${spec.title}`}
      className="rounded-xl border border-slate-200/90 dark:border-slate-800/90 bg-slate-50/75 dark:bg-slate-900/60"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-slate-100/70 dark:hover:bg-slate-800/50 rounded-xl transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Info className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
            Model Assumptions &amp; Formula Reference · {spec.title}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 shrink-0">
          {open ? 'Hide' : 'Inspect'}
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3.5 pt-1 border-t border-slate-200/70 dark:border-slate-800/70 space-y-2 text-xs">
          <div className="font-mono text-[11px] text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 px-3 py-2 rounded border border-slate-200 dark:border-slate-800 overflow-x-auto">
            {spec.formula}
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-800 dark:text-slate-200">Units &amp; basis:</span> {spec.units}
          </div>
          <ul className="list-disc pl-4 space-y-1 text-xs text-slate-600 dark:text-slate-300">
            {spec.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <div className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
            Caveat: {spec.caveats}
          </div>
        </div>
      )}
    </section>
  );
};

export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidth?: string;
  children: React.ReactNode;
}> = ({ open, onClose, title, subtitle, maxWidth = 'max-w-xl', children }) => {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = window.setTimeout(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const autoTarget = dialog.querySelector<HTMLElement>(
        '[autofocus]:not(:disabled), [data-autofocus="true"]:not(:disabled)'
      );
      if (autoTarget) {
        autoTarget.focus();
        return;
      }
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length) focusable[0].focus();
      else dialog.focus();
    }, 10);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not([type="hidden"]):not(:disabled), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
        previousFocusRef.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-[2px] p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descId : undefined}
        tabIndex={-1}
        className={`w-full ${maxWidth} max-h-[90vh] flex flex-col rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl focus:outline-none`}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 id={titleId} className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </h3>
            {subtitle && (
              <p id={descId} className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded p-1 text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
};

export const ConfirmDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}> = ({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
}) => (
  <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-md">
    <div className="space-y-4">
      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{message}</p>
      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
        <Button type="button" variant="ghost" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={danger ? 'danger' : 'primary'}
          data-testid="confirm-dialog-submit"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  </Modal>
);

export const ToastContainer: React.FC<{
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}> = ({ toasts, onDismiss }) => {
  if (!toasts.length) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)] pointer-events-none no-print"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.type === 'error' ? 'alert' : 'status'}
          className="pointer-events-auto flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-xs shadow-lg"
        >
          <span
            className={
              t.type === 'error'
                ? 'text-rose-700 dark:text-rose-400 font-medium'
                : t.type === 'warn'
                  ? 'text-amber-700 dark:text-amber-400 font-medium'
                  : t.type === 'success'
                    ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                    : 'text-slate-700 dark:text-slate-200'
            }
          >
            {t.message}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {t.actionLabel && t.onAction && (
              <button
                type="button"
                onClick={() => {
                  t.onAction?.();
                  onDismiss(t.id);
                }}
                className="font-semibold text-[var(--accent)] hover:underline cursor-pointer"
              >
                {t.actionLabel}
              </button>
            )}
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss notification"
              className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export function downloadFile(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
