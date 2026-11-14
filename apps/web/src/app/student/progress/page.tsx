'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { fmtDate, pctText } from '@/lib/exams';
import { Badge, Card, EmptyState, ErrorState, ListSkeleton, PageTitle, Select, Skeleton } from '@/components/ui';
import type { TrendPoint } from '@/components/TrendChart';

// Recharts is heavy: it loads only when this page needs a chart.
const TrendChart = dynamic(() => import('@/components/TrendChart'), { ssr: false, loading: () => <Skeleton className="h-64" /> });

interface Chapter { chapterId: string; name: string; pct: number; total: number }
interface Progress {
  results: { examId: string; title: string; kind: string; startAt: string; courseId: string; courseCode: string; score: number | null; totalMarks: number; percentage: number | null; grade: string | null; rank: number | null; of: number | null; missed: boolean }[];
  courses: { offeringId: string; courseId: string; courseCode: string; courseName: string; percent: number | null; grade: string | null; rank: number | null; of: number }[];
  trend: { examId: string; at: string; percentage: number | null }[];
  sectionAverageSeries: { examId: string; percentage: number | null }[];
  chapters: { strong: Chapter[]; weak: Chapter[] };
}

export default function StudentProgress() {
  const [courseId, setCourseId] = useState('');
  const all = useQuery({ queryKey: ['progress', ''], queryFn: () => api<Progress>('/exams/me/progress') });
  const q = useQuery({ queryKey: ['progress', courseId], queryFn: () => api<Progress>(`/exams/me/progress?courseId=${courseId}`), enabled: !!courseId });
  const p = courseId ? q.data : all.data;
  const state = courseId ? q : all;
  const series: TrendPoint[] = p
    ? p.trend.map((t, i) => ({ label: fmtDate(t.at), you: t.percentage, section: p.sectionAverageSeries[i]?.percentage ?? null }))
    : [];
  return (
    <>
      <PageTitle action={<a href="/api/exams/me/progress.pdf" className="flex min-h-11 items-center rounded-lg px-3 text-base font-medium text-indigo-700 hover:bg-indigo-50">PDF</a>}>My progress</PageTitle>
      {state.isPending && <ListSkeleton />}
      {state.isError && <ErrorState message={errMsg(state.error)} onRetry={() => void state.refetch()} />}
      {all.data && all.data.courses.length > 1 && (
        <div className="mb-4">
          <Select aria-label="Course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">All courses</option>
            {all.data.courses.map((c) => <option key={c.courseId} value={c.courseId}>{c.courseCode} · {c.courseName}</option>)}
          </Select>
        </div>
      )}
      {p && p.results.length === 0 && <EmptyState title="No results yet" hint="Results appear here after the exam window ends and your teacher publishes them." />}
      {p && p.results.length > 0 && (
        <div className="flex flex-col gap-6">
          <section aria-label="Courses" className="flex flex-col gap-3">
            {p.courses.map((c) => (
              <Card key={c.offeringId} data-testid={`course-${c.courseCode}`} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-semibold">{c.courseCode}</p>
                  <p className="truncate text-base text-slate-600">{c.courseName}</p>
                </div>
                <div className="flex shrink-0 gap-4 text-center">
                  <div><p className="text-sm text-slate-600">Average</p><p data-testid="course-pct" className="text-xl font-bold">{pctText(c.percent)}</p></div>
                  <div><p className="text-sm text-slate-600">Grade</p><p data-testid="course-grade" className="text-xl font-bold">{c.grade ?? '-'}</p></div>
                  <div><p className="text-sm text-slate-600">Rank</p><p data-testid="course-rank" className="text-xl font-bold">{c.rank ? `${c.rank}/${c.of}` : '-'}</p></div>
                </div>
              </Card>
            ))}
          </section>

          <section aria-label="Trend">
            <h2 className="mb-2 text-xl font-semibold">Trend</h2>
            <Card>{series.length > 0 ? <TrendChart data={series} /> : <p className="text-base text-slate-600">Take an exam to see your trend.</p>}</Card>
          </section>

          <section aria-label="Results">
            <h2 className="mb-2 text-xl font-semibold">Results</h2>
            <div className="flex flex-col gap-3">
              {p.results.map((r) => (
                <Card key={r.examId} data-testid={`result-${r.examId}`} className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold">{r.title}</p>
                      <p className="text-base text-slate-600">{r.courseCode} · {r.kind === 'quiz' ? 'Quiz' : 'Exam'} · {fmtDate(r.startAt)}</p>
                    </div>
                    {r.missed && <Badge tone="red">Missed</Badge>}
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div><p className="text-sm text-slate-600">Marks</p><p data-testid="marks" className="text-lg font-bold">{r.missed ? '0' : r.score}/{r.totalMarks}</p></div>
                    <div><p className="text-sm text-slate-600">Percent</p><p data-testid="pct" className="text-lg font-bold">{pctText(r.percentage ?? 0)}</p></div>
                    <div><p className="text-sm text-slate-600">Grade</p><p data-testid="grade" className="text-lg font-bold">{r.grade ?? '-'}</p></div>
                    <div><p className="text-sm text-slate-600">Rank</p><p data-testid="rank" className="text-lg font-bold">{r.rank ? `${r.rank}/${r.of}` : '-'}</p></div>
                  </div>
                </Card>
              ))}
            </div>
          </section>

          <section aria-label="Chapters" className="grid gap-3 sm:grid-cols-2">
            <ChapterList title="Strong chapters" tone="green" id="strong" items={p.chapters.strong} />
            <ChapterList title="Needs work" tone="red" id="weak" items={p.chapters.weak} />
          </section>
        </div>
      )}
    </>
  );
}

function ChapterList({ title, items, id, tone }: { title: string; items: Chapter[]; id: string; tone: 'green' | 'red' }) {
  return (
    <Card data-testid={`chapters-${id}`}>
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="text-base text-slate-600">Not enough data yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((c) => (
            <li key={c.chapterId} className="flex items-center justify-between gap-2 text-base">
              <span className="min-w-0 truncate">{c.name}</span>
              <Badge tone={tone}>{Math.round(c.pct)}%</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
