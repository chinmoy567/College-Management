'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { OfferingLabel } from '@/components/OfferingLabel';
import type { OfferingLite } from '@/lib/exams';
import { Button, Card, PageTitle } from '@/components/ui';
import { ExamForm, type ExamFormValues } from '@/components/ExamForm';
import { QuestionForm, type ChapterLite, type InlineQuestion } from '@/components/QuestionForm';

type Values = ExamFormValues & { startAt: string; endAt: string };

/** One screen: exam settings and the MCQ questions together. The exam is saved as a draft with its questions. */
export default function NewExam() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [questions, setQuestions] = useState<InlineQuestion[]>([]);
  const [adding, setAdding] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const offerings = useQuery({ queryKey: ['exam-offerings'], queryFn: () => api<{ items: OfferingLite[] }>('/exams/offerings') });
  const offering = offerings.data?.items.find((o) => o.id === id);
  const courseId = offering?.courseId;
  const chapters = useQuery({
    queryKey: ['chapters', courseId],
    queryFn: () => api<{ items: ChapterLite[] }>(`/academics/courses/${courseId}/chapters`),
    enabled: !!courseId,
  });
  const total = questions.reduce((s, q) => s + q.marks, 0);

  const save = async (v: Values) => {
    setError('');
    setBusy(true);
    try {
      const e = await api<{ id: string }>('/exams', { method: 'POST', json: { offeringId: id, ...v, instructions: v.instructions || null } });
      try {
        if (questions.length) await api(`/exams/${e.id}/questions`, { method: 'PUT', json: { items: questions.map((inline) => ({ inline })) } });
      } catch {
        // the draft exists; finish the questions on its page
        await qc.invalidateQueries({ queryKey: ['offering-exams', id] });
        router.push(`/teacher/exams/${e.id}`);
        return;
      }
      await qc.invalidateQueries({ queryKey: ['offering-exams', id] });
      router.push(`/teacher/exams/${e.id}`);
    } catch (x) {
      setError(errMsg(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle>New exam</PageTitle>
      <OfferingLabel of={offering} className="-mt-2" />
      <ExamForm formId="exam-settings" offeringId={id} submitLabel="Save exam" onSubmit={save} />

      <h2 className="mb-2 mt-8 text-xl font-semibold">Questions ({questions.length}{questions.length ? ` · ${total} marks` : ''})</h2>
      {questions.length === 0 && <p className="mb-3 text-base text-slate-600">Add your MCQ questions below. You can also add more later.</p>}
      <div className="mb-4 flex flex-col gap-3">
        {questions.map((q, i) => (
          <Card key={i} data-testid={`new-question-${i + 1}`}>
            <p className="text-lg font-medium">{i + 1}. {q.text}</p>
            <ul className="mt-2 flex flex-col gap-1">
              {q.options.map((o, j) => (
                <li key={j} className={q.correct.includes(j) ? 'text-base font-medium text-emerald-700' : 'text-base text-slate-700'}>{q.correct.includes(j) ? '✓ ' : '• '}{o.text}</li>
              ))}
            </ul>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-base text-slate-600">{q.marks} {q.marks === 1 ? 'mark' : 'marks'}</span>
              <Button variant="ghost" onClick={() => setQuestions((all) => all.filter((_, k) => k !== i))}>Remove</Button>
            </div>
          </Card>
        ))}
      </div>
      {adding ? (
        <Card>
          <QuestionForm
            key={questions.length}
            addLabel="Add question"
            chapters={chapters.data?.items ?? []}
            onSubmit={async (q) => { setQuestions((all) => [...all, q]); }}
          />
        </Card>
      ) : (
        <Button variant="secondary" onClick={() => setAdding(true)}>Add another question</Button>
      )}

      {error && <p role="alert" className="mt-4 text-base text-red-700">{error}</p>}
      <button type="submit" form="exam-settings" disabled={busy} data-testid="save-exam" className="mt-6 flex min-h-11 w-full items-center justify-center rounded-lg bg-indigo-600 px-4 text-base font-medium text-white disabled:opacity-60">
        {busy ? 'Saving…' : questions.length ? `Save exam with ${questions.length} question${questions.length === 1 ? '' : 's'}` : 'Save exam'}
      </button>
    </>
  );
}
