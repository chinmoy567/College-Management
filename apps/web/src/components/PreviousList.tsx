'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { EXAM_TYPES, examTypeLabel, previousFileHref, type PreviousRow } from '@/lib/learning';
import { Badge, Button, Card, EmptyState, ErrorState, Input, ListSkeleton, Select } from '@/components/ui';

/** Course → year → exam type, with filters (08 §4). */
export function PreviousList({ staff = false }: { staff?: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [courseId, setCourseId] = useState('');
  const [year, setYear] = useState('');
  const [examType, setExamType] = useState('');
  const all = useQuery({ queryKey: ['previous', ''], queryFn: () => api<{ items: PreviousRow[] }>('/materials/previous-questions') });
  const qs = new URLSearchParams();
  if (courseId) qs.set('courseId', courseId);
  if (year) qs.set('year', year);
  if (examType) qs.set('examType', examType);
  if (text.trim()) qs.set('q', text.trim());
  const list = useQuery({ queryKey: ['previous', qs.toString()], queryFn: () => api<{ items: PreviousRow[] }>(`/materials/previous-questions?${qs}`) });
  const del = useMutation({
    mutationFn: (id: string) => api(`/materials/previous-questions/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['previous'] }),
  });
  // Filter choices come from what exists, so a student never picks an empty combination.
  const courses = [...new Map((all.data?.items ?? []).map((r) => [r.courseId, r.course])).entries()];
  const years = [...new Set((all.data?.items ?? []).map((r) => r.year))].sort((a, b) => b - a);
  const items = list.data?.items ?? [];
  const byCourse = new Map<string, PreviousRow[]>();
  for (const r of items) byCourse.set(r.course, [...(byCourse.get(r.course) ?? []), r]);
  return (
    <div className="flex flex-col gap-3">
      <Input type="search" aria-label="Search" placeholder="Search course or board" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="grid grid-cols-3 gap-2">
        <Select aria-label="Course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          <option value="">Course</option>
          {courses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
        <Select aria-label="Year" value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">Year</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
        <Select aria-label="Exam type" value={examType} onChange={(e) => setExamType(e.target.value)}>
          <option value="">Type</option>
          {EXAM_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </div>
      {list.isPending && <ListSkeleton />}
      {list.isError && <ErrorState message={errMsg(list.error)} onRetry={() => void list.refetch()} />}
      {list.data && items.length === 0 && <EmptyState title="No questions found" hint="Try a different year or exam type." />}
      {[...byCourse.entries()].map(([course, rows]) => (
        <section key={course} className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">{course}</h2>
          {rows.map((r) => (
            <Card key={r.id} data-testid={`previous-${r.id}`} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-lg font-semibold">{r.year} · {examTypeLabel(r.examType)}</p>
                {r.board && <Badge>{r.board}</Badge>}
              </div>
              <div className="flex flex-wrap gap-1">
                {r.files.map((f, i) => (
                  <span key={f.id} className="flex">
                    <a href={previousFileHref(r.id, f.id)} target="_blank" rel="noopener" className="flex min-h-11 items-center rounded-lg px-3 text-base font-medium text-indigo-700 hover:bg-indigo-50">Question {r.files.length > 1 ? i + 1 : ''}</a>
                    <a href={previousFileHref(r.id, f.id, 'download')} aria-label={`Download question ${i + 1}`} className="flex min-h-11 items-center rounded-lg px-2 text-base text-slate-600 hover:bg-slate-100">Save</a>
                  </span>
                ))}
                {r.solutionId && <a href={previousFileHref(r.id, r.solutionId)} target="_blank" rel="noopener" className="flex min-h-11 items-center rounded-lg px-3 text-base font-medium text-emerald-700 hover:bg-emerald-50">Solution</a>}
              </div>
              {staff && r.mine && <Button variant="ghost" disabled={del.isPending} onClick={() => del.mutate(r.id)}>Delete</Button>}
            </Card>
          ))}
        </section>
      ))}
    </div>
  );
}
