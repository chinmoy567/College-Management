'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { fmtDateTime, pctText, type ExamRow, type OfferingLite } from '@/lib/exams';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, ListSkeleton, PageTitle, Sheet } from '@/components/ui';

interface Attempt { attemptId: string; name: string; roll: string | null; attemptNo: number; status: string; score: number | null; submittedAt: string | null; extraMinutes: number; integrity: { blur: number; focus: number; fullscreen_exit: number; visibility_hidden: number; total: number } }
interface Report {
  exam: { id: string; title: string; totalMarks: number; passMarks: number; status: string; resultsPublishedAt: string | null };
  summary: { enrolled: number; attended: number; highest: number | null; lowest: number | null; average: number | null; passed: number };
  distribution: { from: number; to: number; count: number }[];
  perQuestion: { examQuestionId: string; order: number; text: string; marks: number; isCancelled: boolean; correctPct: number | null; answered: number }[];
  didNotAttend: { studentId: string; name: string; roll: string | null }[];
  attempts: Attempt[];
}

export default function ExamReport() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['exam-report', id], queryFn: () => api<Report>(`/exams/${id}/report`) });
  const exam = useQuery({ queryKey: ['exam', id], queryFn: () => api<ExamRow>(`/exams/${id}`) });
  const offerings = useQuery({ queryKey: ['exam-offerings'], queryFn: () => api<{ items: OfferingLite[] }>('/exams/offerings') });
  const owner = offerings.data?.items.find((o) => o.id === exam.data?.offeringId)?.teaches ?? false;
  const [extend, setExtend] = useState<Attempt | null>(null);

  if (q.isPending) return <ListSkeleton />;
  if (q.isError) return <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const max = Math.max(1, ...r.distribution.map((b) => b.count));
  return (
    <>
      <PageTitle>Report: {r.exam.title}</PageTitle>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <a href={`/api/exams/${id}/report.csv`} className="flex min-h-11 items-center justify-center rounded-lg bg-slate-100 text-base font-medium">Export CSV</a>
        <a href={`/api/exams/${id}/report.pdf`} className="flex min-h-11 items-center justify-center rounded-lg bg-slate-100 text-base font-medium">Export PDF</a>
      </div>
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="summary">
        {[
          ['Attended', `${r.summary.attended}/${r.summary.enrolled}`],
          ['Highest', r.summary.highest ?? '-'],
          ['Average', r.summary.average ?? '-'],
          ['Lowest', r.summary.lowest ?? '-'],
        ].map(([k, v]) => (
          <Card key={k} className="text-center"><p className="text-sm text-slate-600">{k}</p><p className="text-2xl font-bold">{v}</p></Card>
        ))}
      </section>

      <section aria-label="Distribution" className="mt-6">
        <h2 className="mb-2 text-xl font-semibold">Score distribution</h2>
        <Card>
          <ul className="flex flex-col gap-1">
            {r.distribution.map((b) => (
              <li key={b.from} className="flex items-center gap-2 text-sm">
                <span className="w-16 shrink-0 text-slate-600">{b.from}-{Math.floor(b.to)}%</span>
                <span className="h-4 rounded bg-indigo-500" style={{ width: `${(b.count / max) * 100}%`, minWidth: b.count ? 4 : 0 }} />
                <span className="font-medium">{b.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section aria-label="Per question" className="mt-6">
        <h2 className="mb-2 text-xl font-semibold">Per question</h2>
        <div className="flex flex-col gap-2">
          {r.perQuestion.map((p) => (
            <Card key={p.examQuestionId} className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-base">{p.order}. {p.text}</p>
              {p.isCancelled ? <Badge tone="red">Cancelled</Badge> : <Badge tone={p.correctPct !== null && p.correctPct < 40 ? 'red' : 'green'}>{pctText(p.correctPct)}</Badge>}
            </Card>
          ))}
        </div>
      </section>

      <section aria-label="Students" className="mt-6">
        <h2 className="mb-2 text-xl font-semibold">Attempts</h2>
        {r.attempts.length === 0 && <EmptyState title="No attempts yet" />}
        <div className="flex flex-col gap-3">
          {r.attempts.map((a) => (
            <Card key={a.attemptId} data-testid={`attempt-${a.attemptId}`} className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold">{a.name}</p>
                  <p className="text-base text-slate-600">Roll {a.roll ?? '-'} · attempt {a.attemptNo}</p>
                </div>
                <p className="text-xl font-bold">{a.score ?? '-'}<span className="text-base font-normal text-slate-600">/{r.exam.totalMarks}</span></p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone={a.status === 'in_progress' ? 'amber' : 'slate'}>{a.status.replace('_', ' ')}</Badge>
                {a.extraMinutes > 0 && <Badge tone="amber">+{a.extraMinutes} min</Badge>}
                <Badge tone={a.integrity.total > 0 ? 'amber' : 'slate'}>Integrity events {a.integrity.total}</Badge>
              </div>
              {a.integrity.total > 0 && (
                <p className="text-sm text-slate-600">Left tab {a.integrity.visibility_hidden} · blur {a.integrity.blur} · fullscreen exit {a.integrity.fullscreen_exit}</p>
              )}
              {owner && <Button variant="secondary" onClick={() => setExtend(a)}>{a.status === 'in_progress' ? 'Give extra time' : 'Reopen with extra time'}</Button>}
            </Card>
          ))}
        </div>
      </section>

      <section aria-label="Did not attend" className="mt-6">
        <h2 className="mb-2 text-xl font-semibold">Did not attend ({r.didNotAttend.length})</h2>
        <Card>
          {r.didNotAttend.length === 0 ? <p className="text-base text-slate-600">Everyone took part.</p> : (
            <ul className="flex flex-col gap-1">{r.didNotAttend.map((d) => <li key={d.studentId} className="text-base">{d.name} <span className="text-slate-600">Roll {d.roll ?? '-'}</span></li>)}</ul>
          )}
        </Card>
      </section>

      <Sheet open={!!extend} title="Extra time" onClose={() => setExtend(null)}>
        {extend && <ExtendForm attempt={extend} onDone={async () => { setExtend(null); await qc.invalidateQueries({ queryKey: ['exam-report', id] }); }} />}
      </Sheet>
      <p className="mt-6 text-sm text-slate-600">Window closes {exam.data ? fmtDateTime(exam.data.endAt) : ''} (Dhaka time).</p>
    </>
  );
}

function ExtendForm({ attempt, onDone }: { attempt: Attempt; onDone: () => Promise<void> }) {
  const [minutes, setMinutes] = useState('10');
  const live = attempt.status === 'in_progress';
  const m = useMutation({
    mutationFn: () => api(`/exams/attempts/${attempt.attemptId}/extend`, { method: 'POST', json: { minutes: Number(minutes), ...(live ? {} : { reopen: true }) } }),
    onSuccess: onDone,
  });
  const n = Number(minutes);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base">{attempt.name}. {live ? 'Adds time to the running attempt.' : 'The attempt is reopened with its saved answers and must be submitted again. Results are held back until it is finished.'}</p>
      <Field label="Minutes (1 to 120)">
        <Input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} />
      </Field>
      {m.isError && <p role="alert" className="text-base text-red-700">{errMsg(m.error)}</p>}
      <Button disabled={!(n >= 1 && n <= 120) || m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Saving…' : live ? 'Add time' : 'Reopen'}</Button>
    </div>
  );
}
