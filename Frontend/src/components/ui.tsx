import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ApiError } from '../lib/api';
import { titleCase } from '../lib/format';

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-300',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-300',
  ghost: 'text-brand-700 hover:bg-brand-50 disabled:text-slate-400',
};

export function Button({
  variant = 'primary',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed',
        buttonStyles[variant],
        className,
      )}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export function Spinner({ small = false }: { small?: boolean }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', small ? 'h-3.5 w-3.5' : 'h-6 w-6 text-brand-600')}
    />
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('min-w-0 rounded-xl border border-slate-200/80 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const toneStyles = {
  neutral: 'bg-slate-100 text-slate-700',
  info: 'bg-sky-100 text-sky-800',
  good: 'bg-emerald-100 text-emerald-800',
  warn: 'bg-amber-100 text-amber-800',
  bad: 'bg-red-100 text-red-800',
} as const;

type Tone = keyof typeof toneStyles;

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'good',
  POSTED: 'good',
  PAID: 'good',
  COMMITTED: 'good',
  APPROVED: 'info',
  SUBMITTED: 'info',
  READY_TO_COMMIT: 'info',
  PARTIALLY_PAID: 'info',
  CREDIT: 'good',
  DEBIT: 'warn',
  UPHELD: 'good',
  WITHDRAWN: 'neutral',
  PENDING: 'warn',
  OPEN_DISPUTE: 'warn',
  OPEN: 'neutral',
  DRAFT: 'neutral',
  NOT_YET_DUE: 'neutral',
  SETTLED: 'good',
  NEEDS_REVIEW: 'warn',
  DISPUTED: 'warn',
  SUSPENDED: 'warn',
  DAYS_1_30: 'warn',
  DAYS_31_60: 'warn',
  DAYS_61_90: 'bad',
  DAYS_91_120: 'bad',
  OVER_120: 'bad',
  REJECTED: 'bad',
  REVERSED: 'bad',
  FAILED: 'bad',
  CANCELLED: 'bad',
};

const BUCKET_LABEL: Record<string, string> = {
  NOT_YET_DUE: 'Not yet due',
  DAYS_1_30: '1–30 days',
  DAYS_31_60: '31–60 days',
  DAYS_61_90: '61–90 days',
  DAYS_91_120: '91–120 days',
  OVER_120: 'Over 120 days',
  SETTLED: 'Settled',
};

/** Status is always conveyed by text as well as colour. */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cx('inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', toneStyles[STATUS_TONE[status] ?? 'neutral'])}>
      {BUCKET_LABEL[status] ?? titleCase(status)}
    </span>
  );
}

const noticeStyles: Record<Tone, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  bad: 'border-red-200 bg-red-50 text-red-900',
  neutral: 'border-slate-200 bg-slate-50 text-slate-800',
};

export function Notice({ tone = 'info', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={cx('rounded-md border px-3 py-2 text-sm', noticeStyles[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      {children}
    </div>
  );
}
/** Shows what failed, where, and the support reference (correlation id) for an API error. */
export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  if (!(error instanceof ApiError)) {
    return (
      <Notice tone="bad" title="Something went wrong">
        {error instanceof Error ? error.message : String(error)}
      </Notice>
    );
  }
  return (
    <Notice tone="bad" title={error.message}>
      {error.details.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {error.details.slice(0, 12).map((detail, index) => (
            <li key={index}>
              {detail.field && <span className="font-mono text-xs">{detail.field}: </span>}
              {detail.message ?? detail.code}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs opacity-75">
        {error.code}
        {error.correlationId ? ` · ref ${error.correlationId}` : ''}
      </p>
    </Notice>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-slate-500" role="status">
      <Spinner />
      {label}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const controlStyles = 'w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm placeholder:text-slate-400 disabled:bg-slate-100';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(controlStyles, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(controlStyles, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(controlStyles, props.className)} />;
}

export function Table({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, numeric }: { children?: ReactNode; numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cx(
        'whitespace-nowrap border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500',
        numeric ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, numeric, className }: { children?: ReactNode; numeric?: boolean; className?: string }) {
  return <td className={cx('border-b border-slate-100 px-3 py-2 align-top', numeric && 'num', className)}>{children}</td>;
}

export function Pagination({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (page: number) => void }) {
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
      <span>
        {total} record{total === 1 ? '' : 's'}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span aria-live="polite">
          Page {page} of {totalPages}
        </span>
        <Button variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function KeyValue({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([key, value]) => (
        <div key={key}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{key}</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Modal dialog: Escape closes, Tab stays inside, focus moves in on open and returns on close. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Callers pass a new onClose on every render; keep it in a ref so the effect below runs once.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === ref.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx('mt-12 w-full rounded-lg bg-white shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded p-1 text-slate-500 hover:bg-slate-100">
            ✕
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
