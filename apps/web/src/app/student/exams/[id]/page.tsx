'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { OfferingLabel } from '@/components/OfferingLabel';
import { countdownText, fmtDateTime, pctText, type OfferingCtx, useServerOffset, useTick } from '@/lib/exams';
import { Badge, Button, Card, ErrorState, ListSkeleton, PageTitle, cn } from '@/components/ui';

interface QResult { id: string; text: string; marks: number; isCancelled: boolean; options: { id: string; text: string }[]; selectedOptionIds: string[]; isCorrect: boolean; marksAwarded: number | null; correct?: string[] }
interface Result {
  id: string; attemptNo: number; status: string; state?: string; resultPending?: boolean; totalMarks: number; score?: number; percentage?: number; grade?: string | null;
  passMarks?: number; passed?: boolean; rank?: { rank: number; of: number; sectionAverage: number }; questions?: QResult[]; deadlineAt?: string;
}
interface Summary extends OfferingCtx {
  id: string; kind: 'exam' | 'quiz'; title: string; instructions: string | null; startAt: string; endAt: string; durationMin: number; totalMarks: number; passMarks: number;
  maxAttempts: number; resultMode: string; serverNow: string; attemptsUsed: number; canStart: boolean; inProgressAttemptId: string | null; attempts: Result[];
}

export default function StudentExam() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useQuery({ queryKey: ['my-exam', id], queryFn: () => api<Summary>(`/exams/${id}`) });
  const offset = useServerOffset(q.data?.serverNow);
  const tick = useTick();
  const start = useMutation({
    mutationFn: () => api<{ id: string }>(`/exams/${id}/attempts`, { method: 'POST' }),
    onSuccess: (a) => router.push(`/student/take/${a.id}`),
  });
  const [open, setOpen] = useState<string | null>(null);
  if (q.isPending) return <ListSkeleton />;
  if (q.isError) return <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />;
  const e = q.data;
  const nowMs = tick + offset;
  const toStart = new Date(e.startAt).getTime() - nowMs;
  const finished = e.attempts.filter((a) => a.status !== 'in_progress');
  return (
    <>
      <PageTitle>{e.title}</PageTitle>
      <OfferingLabel of={e} className="-mt-2" />
      <Card className="flex flex-col gap-1 text-base">
        <p>{e.kind === 'quiz' ? 'Quiz' : 'Exam'} · {e.totalMarks} marks · pass {e.passMarks} · {e.durationMin} min</p>
        <p>Window: {fmtDateTime(e.startAt)} – {fmtDateTime(e.endAt)} (Dhaka time)</p>
        <p>Attempts: {e.attemptsUsed}{e.maxAttempts === 0 ? '' : ` of ${e.maxAttempts}`}</p>
        {e.instructions && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3">{e.instructions}</p>}
        {toStart > 0 && <p data-testid="countdown" className="mt-2 font-medium text-amber-800">Starts in {countdownText(toStart)}</p>}
        {(e.canStart || e.inProgressAttemptId) && (
          <Button data-testid="start-exam" className="mt-3 w-full" disabled={start.isPending} onClick={() => start.mutate()}>
            {e.inProgressAttemptId ? 'Resume exam' : 'Start exam'}
          </Button>
        )}
        {start.isError && <p role="alert" className="text-red-700">{errMsg(start.error)}</p>}
        <p className="text-sm text-slate-600">The timer starts when you tap Start and keeps running if you leave the page.</p>
      </Card>

      {finished.length > 0 && <h2 className="mb-2 mt-6 text-xl font-semibold">Your attempts</h2>}
      <div className="flex flex-col gap-3">
        {finished.map((a) => (
          <Card key={a.id} data-testid={`attempt-${a.attemptNo}`} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-lg font-semibold">Attempt {a.attemptNo}</p>
              <Badge tone={a.status === 'auto_submitted' ? 'amber' : 'green'}>{a.status === 'auto_submitted' ? 'Auto-submitted' : 'Submitted'}</Badge>
            </div>
            {a.score === undefined ? (
              <p className="text-base text-slate-700" data-testid="result-pending">{e.resultMode === 'manual' ? 'Submitted, result pending.' : 'Submitted. Your result appears when the exam window ends.'}</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-sm text-slate-600">Marks</p><p className="text-xl font-bold">{a.score}/{a.totalMarks}</p></div>
                <div><p className="text-sm text-slate-600">Percent</p><p className="text-xl font-bold">{pctText(a.percentage)}</p></div>
                <div><p className="text-sm text-slate-600">{a.rank ? 'Section rank' : 'Grade'}</p><p className="text-xl font-bold">{a.rank ? `${a.rank.rank}/${a.rank.of}` : (a.grade ?? '-')}</p></div>
              </div>
            )}
            {a.questions && (
              <>
                <Button variant="secondary" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Hide answers' : 'Review answers'}</Button>
                {open === a.id && (
                  <ol className="flex flex-col gap-3">
                    {a.questions.map((x, i) => (
                      <li key={x.id} className={cn('rounded-lg border p-3', x.isCancelled ? 'border-slate-300' : x.isCorrect ? 'border-emerald-300 bg-emerald-50' : 'border-red-200 bg-red-50')}>
                        <p className="text-base font-medium">{i + 1}. {x.text}</p>
                        <p className="text-sm text-slate-600">{x.isCancelled ? 'Cancelled, full marks to everyone' : x.isCorrect ? 'Right' : 'Wrong or not answered'} · {x.marksAwarded ?? 0}/{x.marks}</p>
                        <ul className="mt-1 flex flex-col gap-1 text-base">
                          {x.options.map((o) => (
                            <li key={o.id} className={cn(x.selectedOptionIds.includes(o.id) && 'font-semibold')}>
                              {x.selectedOptionIds.includes(o.id) ? 'You: ' : ''}{x.correct?.includes(o.id) ? '(correct) ' : ''}{o.text}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
