import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx('flex flex-col gap-5 border-b border-[var(--mos-border-subtle)] pb-6 md:flex-row md:items-end md:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--mos-text-faint)]">{eyebrow}</p>}
        <h1 className="text-[28px] font-[560] tracking-[-0.035em] text-[var(--mos-text)] md:text-[32px]">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--mos-text-muted)]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div>
        <h2 className="text-sm font-[560] tracking-[-0.01em] text-[var(--mos-text)]">{title}</h2>
        {description && <p className="mt-1 text-xs leading-5 text-[var(--mos-text-muted)]">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Panel({
  children,
  className,
  padding = 'default',
  ...props
}: HTMLAttributes<HTMLElement> & { padding?: 'none' | 'compact' | 'default' }) {
  return (
    <section
      className={cx(
        'overflow-hidden rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] shadow-[var(--mos-shadow-panel)]',
        padding === 'compact' && 'p-4',
        padding === 'default' && 'p-5 md:p-6',
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  note,
  trend,
  className,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  trend?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('min-w-0 border-l border-[var(--mos-border-subtle)] px-5 py-4 first:border-l-0', className)}>
      <p className="text-[11px] font-medium text-[var(--mos-text-muted)]">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="truncate text-2xl font-[560] tracking-[-0.035em] text-[var(--mos-text)]">{value}</p>
        {trend && <span className="text-[11px] text-[var(--mos-accent-soft)]">{trend}</span>}
      </div>
      {note && <p className="mt-1 truncate text-[11px] text-[var(--mos-text-faint)]">{note}</p>}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

export function Button({ className, variant = 'secondary', size = 'md', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[var(--mos-radius-control)] border font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mos-accent-ring)] disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'border-[var(--mos-accent)] bg-[var(--mos-accent)] text-white hover:bg-[var(--mos-accent-hover)]',
        variant === 'secondary' && 'border-[var(--mos-border)] bg-[var(--mos-raised)] text-[var(--mos-text-secondary)] hover:border-[var(--mos-border-strong)] hover:text-[var(--mos-text)]',
        variant === 'ghost' && 'border-transparent bg-transparent text-[var(--mos-text-muted)] hover:bg-white/[0.04] hover:text-[var(--mos-text)]',
        variant === 'danger' && 'border-red-400/20 bg-red-400/10 text-red-300 hover:bg-red-400/15',
        className,
      )}
      {...props}
    />
  );
}

export function FormField({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-[var(--mos-text-secondary)]">
        <span>{label}{required && <span className="ml-1 text-[var(--mos-accent-soft)]">*</span>}</span>
        {hint && <span className="font-normal text-[var(--mos-text-faint)]">{hint}</span>}
      </span>
      {children}
      {error && <span className="mt-1.5 block text-xs text-red-300">{error}</span>}
    </label>
  );
}

export const fieldClassName =
  'w-full rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-surface)] px-3 text-sm text-[var(--mos-text-secondary)] outline-none transition placeholder:text-[var(--mos-text-faint)] focus:border-[var(--mos-accent-border)] focus:ring-2 focus:ring-[var(--mos-accent-ring)]';

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(fieldClassName, 'h-9', props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(fieldClassName, 'min-h-28 py-2.5 leading-6', props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(fieldClassName, 'h-9 appearance-none pr-9', props.className)} />;
}

export function StatusBadge({
  children,
  tone = 'neutral',
  dot = false,
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  dot?: boolean;
  className?: string;
}) {
  const toneClass = {
    neutral: 'border-white/[0.07] bg-white/[0.035] text-[var(--mos-text-muted)]',
    info: 'border-indigo-400/20 bg-indigo-400/10 text-indigo-200',
    success: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
    warning: 'border-amber-400/20 bg-amber-400/10 text-amber-200',
    danger: 'border-red-400/20 bg-red-400/10 text-red-300',
  }[tone];
  return (
    <span className={cx('inline-flex h-6 items-center gap-1.5 rounded-[var(--mos-radius-control)] border px-2 text-[11px] font-medium', toneClass, className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex min-h-48 flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-4 h-8 w-8 rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)]" />
      <h3 className="text-sm font-medium text-[var(--mos-text-secondary)]">{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-xs leading-5 text-[var(--mos-text-muted)]">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function DataTableFrame({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Panel padding="none" className={className}>
      {(title || action) && (
        <div className="border-b border-[var(--mos-border-subtle)] px-5 py-4">
          <SectionHeader title={title || ''} description={description} action={action} />
        </div>
      )}
      <div className="overflow-x-auto">{children}</div>
    </Panel>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-3 rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-3 sm:flex-row sm:items-center sm:justify-between', className)}>
      {children}
    </div>
  );
}

export function FilterGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex min-w-0 flex-1 flex-wrap items-center gap-2', className)}>{children}</div>;
}

export function PageStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-auto flex w-full max-w-[1480px] flex-col gap-6 pb-8', className)}>{children}</div>;
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex items-center gap-3 text-xs text-[var(--mos-text-muted)]">
        <span className="h-4 w-4 animate-spin rounded-full border border-[var(--mos-border-strong)] border-t-[var(--mos-accent)]" />
        {label}
      </div>
    </div>
  );
}
