'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { OfferingLabel } from '@/components/OfferingLabel';
import { type OfferingCtx, pctText } from '@/lib/exams';
import { Badge, Card, EmptyState, ErrorState, ListSkeleton, PageTitle } from '@/components/ui';

interface Progress extends OfferingCtx {
  exams: { id: string; title: string; totalMarks: number; passMarks: number }[];
  students: { studentId: string; name: string; roll: string | null; percent: number | null; rank: number | null; grade: string | null; examsCounted: number; missed: number }[];
  belowPass: { studentId: string; name: string; roll: string | null; exams: { examId: string; title: string; score: number | null; passMarks: number }[] }[];
}

/** Overall % and rank of every student of the offering, plus who is below the pass mark (teacher, mentor, Admin). */
export default function OfferingProgress() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['offering-progress', id], queryFn: () => api<Progress>(`/exams/offerings/${id}/progress`) });
  return (
    <>
      <PageTitle>Student progress</PageTitle>
      <OfferingLabel of={q.data} className="-mt-2" />
      {q.isPending && <ListSkeleton />}
      {q.isError && <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && q.data.exams.length === 0 && <EmptyState title="No published results yet" hint="Ranks use exams whose results are published. Quizzes are not counted." />}
      {q.data && q.data.exams.length > 0 && (
        <div className="flex flex-col gap-6">
          <section aria-label="Students" className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">Overall ({q.data.exams.length} exam{q.data.exams.length === 1 ? '' : 's'})</h2>
            {q.data.students.map((s) => (
              <Card key={s.studentId} data-testid={`student-${s.studentId}`} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold">{s.name}</p>
                  <p className="text-base text-slate-600">Roll {s.roll ?? '-'}{s.missed > 0 ? ` · missed ${s.missed}` : ''}</p>
                </div>
                <div className="flex shrink-0 gap-4 text-center">
                  <div><p className="text-sm text-slate-600">Avg</p><p className="text-lg font-bold">{pctText(s.percent)}</p></div>
                  <div><p className="text-sm text-slate-600">Grade</p><p className="text-lg font-bold">{s.grade ?? '-'}</p></div>
                  <div><p className="text-sm text-slate-600">Rank</p><p className="text-lg font-bold">{s.rank ?? '-'}</p></div>
                </div>
              </Card>
            ))}
          </section>
          <section aria-label="Below pass marks" className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">Below pass marks</h2>
            {q.data.belowPass.length === 0 && <p className="text-base text-slate-600">Nobody is below the pass marks.</p>}
            {q.data.belowPass.map((s) => (
              <Card key={s.studentId}>
                <p className="text-lg font-semibold">{s.name} <span className="text-base font-normal text-slate-600">Roll {s.roll ?? '-'}</span></p>
                <ul className="mt-1 flex flex-col gap-1">
                  {s.exams.map((e) => (
                    <li key={e.examId} className="flex items-center justify-between gap-2 text-base">
                      <span className="min-w-0 truncate">{e.title}</span>
                      <Badge tone="red">{e.score === null ? 'Missed' : `${e.score}/${e.passMarks}`}</Badge>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </section>
        </div>
      )}
    </>
  );
}
