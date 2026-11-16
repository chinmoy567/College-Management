'use client';

import { useState, type FormEvent } from 'react';
import { OPTION_MAX, OPTION_MIN, inlineQuestionBody } from '@cms/shared';
import { Button, Field, Input, Select, cn } from '@/components/ui';

export interface ChapterLite { id: string; name: string }
export interface InlineQuestion { chapterId: string | null; type: 'single' | 'multiple'; text: string; options: { text: string }[]; correct: number[]; marks: number }

/** One MCQ typed inline while building an exam. Text only (no images, PRD 5.14.1). */
export function QuestionForm({ chapters, onSubmit, addLabel = 'Add to exam' }: { addLabel?: string; chapters: ChapterLite[]; onSubmit: (q: InlineQuestion) => Promise<unknown> }) {
  const [type, setType] = useState<'single' | 'multiple'>('single');
  const [text, setText] = useState('');
  const [options, setOptions] = useState<string[]>(['', '', '', '']);
  const [correct, setCorrect] = useState<number[]>([]);
  const [chapterId, setChapterId] = useState('');
  const [marks, setMarks] = useState('1');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (i: number) => setCorrect((c) => (type === 'single' ? [i] : c.includes(i) ? c.filter((x) => x !== i) : [...c, i]));
  const remove = (i: number) => {
    setOptions((o) => o.filter((_, j) => j !== i));
    setCorrect((c) => c.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // blank options are left out; the ticked answers follow their option to its new position
    const keep = options.map((t, i) => ({ t: t.trim(), i })).filter((o) => o.t);
    const body = { chapterId: chapterId || null, type, text, options: keep.map((o) => ({ text: o.t })), correct: correct.flatMap((c) => { const at = keep.findIndex((o) => o.i === c); return at < 0 ? [] : [at]; }), marks: Number(marks) };
    const parsed = inlineQuestionBody.safeParse(body);
    if (!parsed.success) return void setErr(parsed.error.issues[0]?.message ?? 'Check the question.');
    setErr('');
    setBusy(true);
    try {
      await onSubmit(parsed.data as InlineQuestion);
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      <Field label="Question">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} className="w-full rounded-lg border border-slate-300 p-3 text-base" data-testid="q-text" />
      </Field>
      <Field label="Answer type">
        <Select value={type} onChange={(e) => { setType(e.target.value as 'single' | 'multiple'); setCorrect([]); }}>
          <option value="single">One correct answer</option>
          <option value="multiple">Several correct answers</option>
        </Select>
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-base font-medium">Options (tick the correct {type === 'single' ? 'one' : 'ones'})</legend>
        {options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <button
              type="button"
              role={type === 'single' ? 'radio' : 'checkbox'}
              aria-checked={correct.includes(i)}
              aria-label={`Option ${i + 1} is correct`}
              onClick={() => toggle(i)}
              className={cn('flex size-11 shrink-0 items-center justify-center border-2', type === 'single' ? 'rounded-full' : 'rounded-lg', correct.includes(i) ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-400')}
            >
              {correct.includes(i) ? '✓' : ''}
            </button>
            <Input aria-label={`Option ${i + 1} text`} value={o} maxLength={500} onChange={(e) => setOptions((all) => all.map((x, j) => (j === i ? e.target.value : x)))} data-testid={`q-option-${i}`} />
            {options.length > OPTION_MIN && <Button variant="ghost" aria-label={`Remove option ${i + 1}`} onClick={() => remove(i)}>X</Button>}
          </div>
        ))}
        {options.length < OPTION_MAX && <Button variant="secondary" onClick={() => setOptions((o) => [...o, ''])}>Add option</Button>}
      </fieldset>
      {chapters.length > 0 && (
        <Field label="Chapter (optional)" hint="Used for strong and weak chapter reports.">
          <Select value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
            <option value="">No chapter</option>
            {chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Marks" hint="Steps of 0.5, up to 100.">
        <Input inputMode="decimal" value={marks} onChange={(e) => setMarks(e.target.value.replace(/[^\d.]/g, ''))} />
      </Field>
      {err && <p role="alert" className="text-base text-red-700">{err}</p>}
      <Button type="submit" disabled={busy}>{busy ? 'Adding…' : addLabel}</Button>
    </form>
  );
}
