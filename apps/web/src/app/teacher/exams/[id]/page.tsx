'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { OfferingLabel } from '@/components/OfferingLabel';
import { examStatusTone, fmtDateTime, type BankQuestion, type ExamDetail, type OfferingLite, type TeacherQuestion } from '@/lib/exams';
import { Badge, Button, Card, ErrorState, Input, ListSkeleton, PageTitle, Select, Sheet, cn } from '@/components/ui';
import { ExamForm } from '@/components/ExamForm';
import { QuestionForm, type ChapterLite, type InlineQuestion } from '@/components/QuestionForm';

type Item = { questionId: string } | { inline: InlineQuestion };

/** Teacher exam builder: details, questions (bank picker + inline), publish, and the controls that exist after the start. */
export default function ExamBuilder() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const exam = useQuery({ queryKey: ['exam', id], queryFn: () => api<ExamDetail>(`/exams/${id}`) });
  const offerings = useQuery({ queryKey: ['exam-offerings'], queryFn: () => api<{ items: OfferingLite[] }>('/exams/offerings') });
  const e = exam.data;
  const offering = offerings.data?.items.find((o) => o.id === e?.offeringId);
  const chapters = useQuery({
    queryKey: ['chapters', offering?.courseId],
    queryFn: () => api<{ items: ChapterLite[] }>(`/academics/courses/${offering!.courseId}/chapters`),
    enabled: !!offering,
  });
  const [sheet, setSheet] = useState<'edit' | 'bank' | 'inline' | null>(null);
  const [fixing, setFixing] = useState<TeacherQuestion | null>(null);
  const [notice, setNotice] = useState('');
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['exam', id] }), qc.invalidateQueries({ queryKey: ['offering-exams'] })]);

  const putItems = useMutation({
    mutationFn: (items: Item[]) => api(`/exams/${id}/questions`, { method: 'PUT', json: { items } }),
    onSuccess: async () => { setSheet(null); setNotice(''); await refresh(); },
    onError: (x) => setNotice(errMsg(x)),
  });
  const publish = useMutation({
    mutationFn: () => api<{ warnings?: string[] }>(`/exams/${id}/publish`, { method: 'POST' }),
    onSuccess: async (r) => { setNotice(r.warnings?.includes('MAINTENANCE_WINDOW_OVERLAP') ? 'Published. Note: this overlaps the weekly maintenance window.' : ''); await refresh(); },
    onError: (x) => setNotice(errMsg(x)),
  });
  const publishResults = useMutation({
    mutationFn: () => api(`/exams/${id}/publish-results`, { method: 'POST' }),
    onSuccess: async () => { setNotice('Results published. Students are notified.'); await refresh(); },
    onError: (x) => setNotice(errMsg(x)),
  });
  const del = useMutation({
    mutationFn: () => api(`/exams/${id}`, { method: 'DELETE' }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['offering-exams'] }); router.replace(`/teacher/exams/offerings/${e?.offeringId}`); },
    onError: (x) => setNotice(errMsg(x)),
  });
  const cancelQ = useMutation({
    mutationFn: (qid: string) => api(`/exams/${id}/questions/${qid}/cancel`, { method: 'POST' }),
    onSuccess: async () => { setNotice('Question cancelled. Everyone gets its marks and scores are being recalculated.'); await refresh(); },
    onError: (x) => setNotice(errMsg(x)),
  });

  if (exam.isPending) return <ListSkeleton />;
  if (exam.isError) return <ErrorState message={errMsg(exam.error)} onRetry={() => void exam.refetch()} />;
  if (!e) return null;

  const started = Date.now() >= new Date(e.startAt).getTime();
  const owner = offering?.teaches ?? false;
  const editable = owner && (e.status === 'draft' || (e.status === 'published' && !started));
  const orphan = e.questions.some((x) => !x.questionId); // snapshot question whose bank source is gone: cannot be re-sent
  const current: Item[] = e.questions.flatMap((x) => (x.questionId ? [{ questionId: x.questionId }] : []));
  const total = e.questions.reduce((s, x) => s + x.marks, 0);

  return (
    <>
      <PageTitle>{e.title}</PageTitle>
      <OfferingLabel of={e} className="-mt-2" />
      <Card className="flex flex-col gap-1 text-base" data-testid="exam-summary">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Badge tone={examStatusTone(e.status)}>{e.status === 'draft' ? 'Draft' : e.status === 'published' ? (started ? 'Live or finished' : 'Published') : 'Closed'}</Badge>
          <Badge>{e.kind === 'quiz' ? 'Quiz' : 'Exam'}</Badge>
          {e.resultsPublishedAt && <Badge tone="green">Results published</Badge>}
        </div>
        <p>{fmtDateTime(e.startAt)} – {fmtDateTime(e.endAt)} (Dhaka)</p>
        <p>{e.durationMin} min · {total} marks · pass {e.passMarks} · {e.maxAttempts === 0 ? 'unlimited' : e.maxAttempts} attempt{e.maxAttempts === 1 ? '' : 's'}</p>
        <p>Results: {e.resultMode === 'instant' ? 'instant after the window' : 'manual'}</p>
        {editable && <Button variant="secondary" className="mt-2" onClick={() => setSheet('edit')}>Edit details</Button>}
      </Card>
      {notice && <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-base text-amber-900">{notice}</p>}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {owner && e.status === 'draft' && (
          <Button data-testid="publish-exam" disabled={publish.isPending || e.questions.length === 0} onClick={() => publish.mutate()}>{publish.isPending ? 'Publishing…' : 'Publish exam'}</Button>
        )}
        {owner && e.resultMode === 'manual' && e.status !== 'draft' && !e.resultsPublishedAt && (
          <Button data-testid="publish-results" disabled={publishResults.isPending || !e.revealedAt} onClick={() => publishResults.mutate()}>
            {e.revealedAt ? 'Publish results' : 'Publish results (after the window ends)'}
          </Button>
        )}
        {e.status !== 'draft' && <Link href={`/teacher/exams/${id}/report`} className="flex min-h-11 items-center justify-center rounded-lg bg-slate-100 px-4 text-base font-medium" data-testid="open-report">Report</Link>}
        {editable && (
          <Button variant="danger" disabled={del.isPending} onClick={() => { if (window.confirm('Delete this exam?')) del.mutate(); }}>Delete</Button>
        )}
      </div>

      <div className="mb-2 mt-6 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Questions ({e.questions.length})</h2>
      </div>
      {editable && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Button variant="secondary" data-testid="add-from-bank" onClick={() => setSheet('bank')}>From my bank</Button>
          <Button variant="secondary" data-testid="add-inline" onClick={() => setSheet('inline')}>New question</Button>
        </div>
      )}
      {orphan && editable && <p className="mb-3 text-base text-amber-800">A question in this exam no longer has a bank copy, so the list cannot be edited here.</p>}
      {e.questions.length === 0 && <Card className="text-center text-base text-slate-600">No questions yet. Add some from your bank or type a new one.</Card>}
      <ol className="flex flex-col gap-3">
        {e.questions.map((x, i) => (
          <li key={x.id}>
            <Card data-testid={`question-${i + 1}`} className={cn(x.isCancelled && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 whitespace-pre-wrap text-base font-medium">{i + 1}. {x.text}</p>
                <span className="shrink-0 text-base text-slate-600">{x.marks}m</span>
              </div>
              <ul className="mt-2 flex flex-col gap-1 text-base">
                {x.options.map((o) => (
                  <li key={o.id} className={cn('rounded-md px-2 py-1', x.correct.includes(o.id) && 'bg-emerald-50 font-medium text-emerald-900')}>
                    {x.correct.includes(o.id) ? '✓ ' : ''}{o.text}
                  </li>
                ))}
              </ul>
              {x.isCancelled && <p className="mt-2"><Badge tone="red">Cancelled, full marks to all</Badge></p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {editable && !orphan && e.questions.length > 1 && (
                  <Button variant="ghost" onClick={() => putItems.mutate(current.filter((c) => !('questionId' in c) || c.questionId !== x.questionId))}>Remove</Button>
                )}
                {owner && e.status !== 'draft' && started && !x.isCancelled && (
                  <>
                    <Button variant="secondary" data-testid={`fix-key-${i + 1}`} onClick={() => setFixing(x)}>Fix answer key</Button>
                    <Button variant="danger" onClick={() => { if (window.confirm('Cancel this question? Everyone gets its marks.')) cancelQ.mutate(x.id); }}>Cancel question</Button>
                  </>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ol>

      <Sheet open={sheet === 'edit'} title="Edit details" onClose={() => setSheet(null)}>
        <OfferingLabel of={e} />
        <ExamForm
          offeringId={e.offeringId}
          initial={e}
          submitLabel="Save changes"
          onSubmit={async (v) => {
            await api(`/exams/${id}`, { method: 'PATCH', json: { ...v, instructions: v.instructions || null } });
            setSheet(null);
            await refresh();
          }}
        />
      </Sheet>
      <Sheet open={sheet === 'inline'} title="New question" onClose={() => setSheet(null)}>
        <QuestionForm chapters={chapters.data?.items ?? []} onSubmit={(q) => putItems.mutateAsync([...current, { inline: q }])} />
        {putItems.isError && <p role="alert" className="mt-3 text-base text-red-700">{errMsg(putItems.error)}</p>}
      </Sheet>
      <Sheet open={sheet === 'bank'} title="My question bank" onClose={() => setSheet(null)}>
        {offering && (
          <BankPicker
            courseId={offering.courseId}
            chapters={chapters.data?.items ?? []}
            taken={new Set(e.questions.map((x) => x.questionId).filter((x): x is string => !!x))}
            onAdd={(ids) => putItems.mutate([...current, ...ids.map((questionId) => ({ questionId }))])}
            busy={putItems.isPending}
          />
        )}
      </Sheet>
      <Sheet open={!!fixing} title="Fix answer key" onClose={() => setFixing(null)}>
        {fixing && <FixKey q={fixing} examId={id} onDone={async () => { setFixing(null); setNotice('Key fixed. Scores are being recalculated and students are notified.'); await refresh(); }} />}
      </Sheet>
    </>
  );
}

function BankPicker({ courseId, chapters, taken, onAdd, busy }: { courseId: string; chapters: ChapterLite[]; taken: Set<string>; onAdd: (ids: string[]) => void; busy: boolean }) {
  const [chapterId, setChapterId] = useState('');
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const q = useInfiniteQuery({
    queryKey: ['bank', courseId, chapterId, text],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api<{ items: BankQuestion[]; nextCursor: string | null }>(`/exams/bank?courseId=${courseId}&limit=20${chapterId ? `&chapterId=${chapterId}` : ''}${text ? `&q=${encodeURIComponent(text)}` : ''}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <Input type="search" placeholder="Search questions" aria-label="Search questions" value={text} onChange={(e) => setText(e.target.value)} />
      {chapters.length > 0 && (
        <Select aria-label="Chapter" value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
          <option value="">All chapters</option>
          {chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      )}
      {q.isPending && <ListSkeleton rows={2} />}
      {q.isError && <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && items.length === 0 && <p className="text-base text-slate-600">No questions found. Use New question to write one.</p>}
      <ul className="flex flex-col gap-2">
        {items.map((b) => {
          const used = taken.has(b.id);
          const on = picked.includes(b.id);
          return (
            <li key={b.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on || used}
                disabled={used}
                data-testid={`bank-${b.id}`}
                onClick={() => setPicked((p) => (on ? p.filter((x) => x !== b.id) : [...p, b.id]))}
                className={cn('flex min-h-11 w-full items-start gap-3 rounded-lg border p-3 text-left text-base disabled:opacity-50', on ? 'border-indigo-600 bg-indigo-50' : 'border-slate-300')}
              >
                <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border border-slate-400 text-sm">{on || used ? '✓' : ''}</span>
                <span className="min-w-0">
                  <span className="block break-words">{b.text}</span>
                  <span className="text-sm text-slate-600">{b.type === 'single' ? 'One answer' : 'Several answers'} · {b.marks}m{used ? ' · already added' : ''}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {q.hasNextPage && <Button variant="secondary" onClick={() => void q.fetchNextPage()}>Load more</Button>}
      <Button disabled={picked.length === 0 || busy} data-testid="bank-add" onClick={() => onAdd(picked)}>{busy ? 'Adding…' : `Add ${picked.length} selected`}</Button>
    </div>
  );
}

function FixKey({ q, examId, onDone }: { q: TeacherQuestion; examId: string; onDone: () => Promise<void> }) {
  const [sel, setSel] = useState<string[]>(q.correct);
  const m = useMutation({
    mutationFn: () => api(`/exams/${examId}/questions/${q.id}/fix-key`, { method: 'POST', json: { correct: sel } }),
    onSuccess: onDone,
  });
  const toggle = (o: string) => setSel((s) => (q.type === 'single' ? [o] : s.includes(o) ? s.filter((x) => x !== o) : [...s, o]));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base font-medium">{q.text}</p>
      <p className="text-sm text-slate-600">Every submitted attempt is regraded and students are notified.</p>
      {q.options.map((o) => (
        <button key={o.id} type="button" role={q.type === 'single' ? 'radio' : 'checkbox'} aria-checked={sel.includes(o.id)} onClick={() => toggle(o.id)}
          className={cn('min-h-11 rounded-lg border-2 px-3 py-2 text-left text-base', sel.includes(o.id) ? 'border-emerald-600 bg-emerald-50' : 'border-slate-300')}>
          {sel.includes(o.id) ? '✓ ' : ''}{o.text}
        </button>
      ))}
      {m.isError && <p role="alert" className="text-base text-red-700">{errMsg(m.error)}</p>}
      <Button disabled={sel.length === 0 || m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Saving…' : 'Save key'}</Button>
    </div>
  );
}
