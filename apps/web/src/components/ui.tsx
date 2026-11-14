'use client';

import { useEffect, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const variants = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300',
  secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200 disabled:opacity-50',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  ghost: 'text-indigo-700 hover:bg-indigo-50 disabled:opacity-50',
} as const;

export function Button({ variant = 'primary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return (
    <button
      type="button"
      {...p}
      className={cn('inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-base font-medium transition-colors', variants[variant], className)}
    />
  );
}

export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement> & { 'data-testid'?: string }) => (
  <div {...p} className={cn('rounded-xl border border-slate-200 bg-white p-4 shadow-sm', className)} />
);

const tones = { green: 'bg-emerald-100 text-emerald-800', slate: 'bg-slate-200 text-slate-700', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800' };
export const Badge = ({ tone = 'slate', children }: { tone?: keyof typeof tones; children: ReactNode }) => (
  <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium', tones[tone])}>{children}</span>
);

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-base font-medium text-slate-800">{label}</span>
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
const control = 'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100';
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cn(control, className)} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cn(control, className)} />;

export const Skeleton = ({ className }: { className?: string }) => <div aria-hidden className={cn('animate-pulse rounded-lg bg-slate-200', className)} />;
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
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/40 sm:items-center sm:p-6">
      <div role="dialog" aria-modal="true" aria-label={title} className="flex w-full flex-col bg-white sm:max-h-[90vh] sm:max-w-lg sm:rounded-2xl">
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
    <h1 className="text-2xl font-semibold">{children}</h1>
    {action}
  </div>
);
