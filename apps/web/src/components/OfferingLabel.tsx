import { offeringLabel, type OfferingCtx } from '@/lib/exams';

/** Subtitle naming the class an exam screen is about: course, session, group, class and section. */
export function OfferingLabel({ of, className = '' }: { of?: Partial<OfferingCtx> | null; className?: string }) {
  if (!of?.course || of.session === undefined || of.group === undefined || of.section === undefined || of.classLevel === undefined) return null;
  return <p className={`mb-3 text-base text-slate-600 ${className}`} data-testid="offering-label">{offeringLabel(of as OfferingCtx)}</p>;
}
