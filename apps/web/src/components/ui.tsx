'use client';

import { useEffect, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const variants = {
  primary: 'bg-ink text-white hover:bg-deep disabled:bg-slate-300',
  secondary: 'bg-white text-ink ring-1 ring-inset ring-slate-300 hover:bg-mist/40 disabled:opacity-50',
  danger: 'bg-rust text-white hover:bg-rust-dark disabled:opacity-50',
  ghost: 'text-deep hover:bg-mist/40 disabled:opacity-50',
} as const;

export function Button({ variant = 'primary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return (
    <button
      type="button"
      {...p}
      className={cn('inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-base font-semibold transition-all duration-200 active:scale-[0.97]', variants[variant], className)}
    />
  );
}

export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement> & { 'data-testid'?: string }) => (
  <div {...p} className={cn('rounded-2xl border border-slate-200/80 bg-white p-4 transition-shadow hover:shadow-[0_10px_30px_-18px_rgba(0,49,53,0.45)]', className)} />
);

const tones = { green: 'bg-teal/15 text-deep', slate: 'bg-slate-200 text-slate-700', amber: 'bg-amber-100 text-amber-900', red: 'bg-rust/15 text-rust-dark' };
export const Badge = ({ tone = 'slate', children }: { tone?: keyof typeof tones; children: ReactNode }) => (
  <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide', tones[tone])}>{children}</span>
);

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold uppercase tracking-wide text-slate-600">{label}</span>
      {children}
      {hint && !error && <span className="text-sm text-slate-500">{hint}</span>}
      {error && (
        <span role="alert" className="text-sm text-red-700">
          {error}
        </span>
      )}
    </label>
  );
}
const control = 'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-base text-slate-900 transition-shadow focus:border-teal focus:outline-none focus:ring-4 focus:ring-mist/60 disabled:bg-slate-100';
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cn(control, className)} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cn(control, className)} />;

export const Skeleton = ({ className }: { className?: string }) => <div aria-hidden className={cn('animate-pulse rounded-2xl bg-slate-200/70', className)} />;
export const ListSkeleton = ({ rows = 3 }: { rows?: number }) => (
  <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
    {Array.from({ length: rows }, (_, i) => (
      <Skeleton key={i} className="h-20" />
    ))}
  </div>
);

export const EmptyState = ({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) => (
  <Card className="flex flex-col items-center gap-2 py-8 text-center">
    <p className="text-lg font-semibold">{title}</p>
    {hint && <p className="text-base text-slate-600">{hint}</p>}
    {action}
  </Card>
);

export const ErrorState = ({ message, onRetry }: { message?: string; onRetry?: () => void }) => (
  <Card className="flex flex-col items-center gap-3 border-red-200 py-8 text-center" >
    <p role="alert" className="text-base text-red-800">{message ?? 'Something went wrong.'}</p>
    {onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
  </Card>
);

/** Full-screen on phones, centred panel from sm. No transform animation, so it is safe for reduced motion. */
export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-ink/60 backdrop-blur-sm sm:items-center sm:p-6">
      <div role="dialog" aria-modal="true" aria-label={title} className="flex w-full flex-col bg-white sm:max-h-[90vh] sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="ghost" aria-label="Close" onClick={onClose}>Close</Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export const PageTitle = ({ children, action }: { children: ReactNode; action?: ReactNode }) => (
  <div className="mb-4 flex items-center justify-between gap-3">
    <h1 className="text-3xl font-semibold text-ink">{children}</h1>
    {action}
  </div>
);
