'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import type { ChapterRow, CourseRow, RecordingRow } from '@/lib/learning';
import { Badge, Button, Card, EmptyState, ErrorState, Input, ListSkeleton, Select } from '@/components/ui';

/** Browse course → chapter, search, embedded player (lazy iframe). Students also report "opened" for the watched badge. */
export function RecordingList({ student, canDelete = false }: { student: boolean; canDelete?: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [courseId, setCourseId] = useState('');
  const [free, setFree] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const courses = useQuery({ queryKey: ['courses-lite'], queryFn: () => api<{ items: CourseRow[] }>('/academics/courses') });
  const chapters = useQuery({
    queryKey: ['chapters', courseId], enabled: !!courseId,
    queryFn: () => api<{ items: ChapterRow[] }>(`/academics/courses/${courseId}/chapters`),
  });
  const [chapterId, setChapterId] = useState('');
  const qs = new URLSearchParams();
  if (courseId) qs.set('courseId', courseId);
  if (chapterId) qs.set('chapterId', chapterId);
  if (text.trim()) qs.set('q', text.trim());
  if (free) qs.set('scope', 'free');
  const list = useQuery({ queryKey: ['recordings', qs.toString()], queryFn: () => api<{ items: RecordingRow[] }>(`/materials/recordings?${qs}`) });
  const opened = useMutation({
    mutationFn: (id: string) => api(`/materials/recordings/${id}/opened`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['recordings'] }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/materials/recordings/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['recordings'] }),
  });
  const play = (r: RecordingRow) => {
    setOpenId(openId === r.id ? null : r.id);
    if (student && openId !== r.id) opened.mutate(r.id);
  };
  const items = list.data?.items ?? [];
  const groups = new Map<string, RecordingRow[]>();
  for (const r of items) groups.set(`${r.course}${r.chapter ? ` · ${r.chapter}` : ''}`, [...(groups.get(`${r.course}${r.chapter ? ` · ${r.chapter}` : ''}`) ?? []), r]);
  return (
    <div className="flex flex-col gap-3">
      <Input type="search" aria-label="Search recordings" placeholder="Search by title" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <Select aria-label="Course" value={courseId} onChange={(e) => { setCourseId(e.target.value); setChapterId(''); }}>
          <option value="">All courses</option>
          {courses.data?.items.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
        </Select>
        <Select aria-label="Chapter" value={chapterId} disabled={!courseId} onChange={(e) => setChapterId(e.target.value)}>
          <option value="">All chapters</option>
          {chapters.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-base"><input type="checkbox" className="size-5" checked={free} onChange={(e) => setFree(e.target.checked)} /> Free library only</label>
      {list.isPending && <ListSkeleton />}
      {list.isError && <ErrorState message={errMsg(list.error)} onRetry={() => void list.refetch()} />}
      {list.data && items.length === 0 && <EmptyState title="No recordings" hint="Recorded classes appear here when a teacher shares a YouTube or Drive link." />}
      {[...groups.entries()].map(([label, rows]) => (
        <section key={label} className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-slate-700">{label}</h2>
          {rows.map((r) => (
            <Card key={r.id} data-testid={`recording-${r.id}`} className="flex flex-col gap-2">
              <button type="button" onClick={() => play(r)} aria-expanded={openId === r.id} className="flex min-h-11 w-full items-start justify-between gap-2 text-left">
                <span className="min-w-0">
                  <span className="block text-lg font-semibold">{r.title}</span>
                  {r.description && <span className="block text-base text-slate-600">{r.description}</span>}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {r.visibility === 'college' && <Badge tone="amber">Free</Badge>}
                  {student && r.watched && <Badge tone="green">Watched</Badge>}
                </span>
              </button>
              {openId === r.id && (
                <div className="aspect-video w-full overflow-hidden rounded-lg bg-slate-900">
                  <iframe
                    title={r.title} src={r.embedUrl} loading="lazy" className="size-full" allowFullScreen
                    allow="encrypted-media; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin"
                  />
                </div>
              )}
              {canDelete && r.mine && <Button variant="ghost" disabled={del.isPending} onClick={() => del.mutate(r.id)}>Delete</Button>}
            </Card>
          ))}
        </section>
      ))}
    </div>
  );
}
