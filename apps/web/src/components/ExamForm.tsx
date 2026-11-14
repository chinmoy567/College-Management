'use client';

import { useState, type FormEvent } from 'react';
import { EXAM_DURATIONS, examCreateBody } from '@cms/shared';
import { fieldErrors } from '@/lib/queries';
import { fromDhakaInput, toDhakaInput, type ExamRow } from '@/lib/exams';
import { Button, Field, Input, Select } from '@/components/ui';

export interface ExamFormValues {
  kind: 'exam' | 'quiz'; title: string; instructions: string; startAt: string; endAt: string; durationMin: number; passMarks: number; maxAttempts: number;
  shuffleQuestions: boolean; shuffleOptions: boolean; showAnswersAfterEnd: boolean; resultMode: 'instant' | 'manual';
}

const blank: ExamFormValues = {
  kind: 'exam', title: '', instructions: '', startAt: '', endAt: '', durationMin: 30, passMarks: 0, maxAttempts: 1,
  shuffleQuestions: true, shuffleOptions: false, showAnswersAfterEnd: true, resultMode: 'instant',
};

/** Create / edit form for an exam or quiz. Times are typed as Dhaka wall time. Validated with the shared schema before sending. */
export function ExamForm({ offeringId, initial, submitLabel, onSubmit }: { offeringId: string; initial?: ExamRow; submitLabel: string; onSubmit: (v: ExamFormValues & { startAt: string; endAt: string }) => Promise<unknown> }) {
  const [v, setV] = useState<ExamFormValues>(
    initial
      ? { kind: initial.kind, title: initial.title, instructions: initial.instructions ?? '', startAt: toDhakaInput(initial.startAt), endAt: toDhakaInput(initial.endAt), durationMin: initial.durationMin, passMarks: initial.passMarks, maxAttempts: initial.maxAttempts, shuffleQuestions: initial.shuffleQuestions, shuffleOptions: initial.shuffleOptions, showAnswersAfterEnd: initial.showAnswersAfterEnd, resultMode: initial.resultMode }
      : blank,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const set = <K extends keyof ExamFormValues>(k: K, val: ExamFormValues[K]) => setV((x) => ({ ...x, [k]: val }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    const body = {
      offeringId, ...v, instructions: v.instructions || null,
      startAt: v.startAt ? fromDhakaInput(v.startAt) : '', endAt: v.endAt ? fromDhakaInput(v.endAt) : '',
      maxAttempts: v.kind === 'exam' ? 1 : v.maxAttempts,
    };
    const parsed = examCreateBody.safeParse(body);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? 'form'), i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit({ ...v, startAt: body.startAt, endAt: body.endAt, maxAttempts: body.maxAttempts });
    } catch (err) {
      const f = fieldErrors(err);
      setErrors(f);
      setFormError(Object.keys(f).length ? '' : err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const check = (k: 'shuffleQuestions' | 'shuffleOptions' | 'showAnswersAfterEnd', label: string) => (
    <label className="flex min-h-11 items-center gap-3 text-base">
      <input type="checkbox" className="size-5" checked={v[k]} onChange={(e) => set(k, e.target.checked)} />
      {label}
    </label>
  );
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      <Field label="Title" error={errors.title}>
        <Input value={v.title} maxLength={200} onChange={(e) => set('title', e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Type" error={errors.kind}>
        <Select value={v.kind} onChange={(e) => set('kind', e.target.value as 'exam' | 'quiz')}>
          <option value="exam">Exam (one attempt)</option>
          <option value="quiz">Quiz (several attempts)</option>
        </Select>
      </Field>
      <Field label="Instructions (optional)" error={errors.instructions}>
        <textarea value={v.instructions} onChange={(e) => set('instructions', e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 p-3 text-base" />
      </Field>
      <Field label="Opens (Dhaka time)" error={errors.startAt}>
        <Input type="datetime-local" value={v.startAt} onChange={(e) => set('startAt', e.target.value)} />
      </Field>
      <Field label="Closes (Dhaka time)" error={errors.endAt}>
        <Input type="datetime-local" value={v.endAt} onChange={(e) => set('endAt', e.target.value)} />
      </Field>
      <Field label="Duration" error={errors.durationMin} hint="Each student's timer, capped by the closing time.">
        <Select value={v.durationMin} onChange={(e) => set('durationMin', Number(e.target.value))}>
          {EXAM_DURATIONS.map((d) => <option key={d} value={d}>{d} minutes</option>)}
        </Select>
      </Field>
      <Field label="Pass marks" error={errors.passMarks}>
        <Input inputMode="decimal" value={String(v.passMarks)} onChange={(e) => set('passMarks', Number(e.target.value.replace(/[^\d.]/g, '')) || 0)} />
      </Field>
      {v.kind === 'quiz' && (
        <Field label="Attempts allowed" error={errors.maxAttempts} hint="0 means unlimited. At most 10.">
          <Input inputMode="numeric" value={String(v.maxAttempts)} onChange={(e) => set('maxAttempts', Number(e.target.value.replace(/\D/g, '')) || 0)} />
        </Field>
      )}
      <Field label="Results" error={errors.resultMode} hint="Manual: students see nothing until you publish the results.">
        <Select value={v.resultMode} onChange={(e) => set('resultMode', e.target.value as 'instant' | 'manual')}>
          <option value="instant">Instant, when the exam window ends</option>
          <option value="manual">Manual, I will publish</option>
        </Select>
      </Field>
      <div className="flex flex-col">
        {check('shuffleQuestions', 'Shuffle questions')}
        {check('shuffleOptions', 'Shuffle options')}
        {check('showAnswersAfterEnd', 'Show correct answers after results')}
      </div>
      {formError && <p role="alert" className="text-base text-red-700">{formError}</p>}
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</Button>
    </form>
  );
}
