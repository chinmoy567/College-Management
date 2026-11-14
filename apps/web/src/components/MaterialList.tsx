'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { SCOPE_LABEL, bytes, materialFileHref, type MaterialRow } from '@/lib/learning';
import { Badge, Button, Card, EmptyState, ErrorState, ListSkeleton } from '@/components/ui';

interface Stats { views: number; downloads: number; uniqueViewers: number; uniqueDownloaders: number }

function StatsLine({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['material-stats', id], queryFn: () => api<Stats>(`/materials/${id}/stats`) });
  if (!q.data) return null;
  return <p className="text-sm text-slate-600">{q.data.views} views ({q.data.uniqueViewers} students) · {q.data.downloads} downloads ({q.data.uniqueDownloaders} students)</p>;
}

/** Notes grouped course → chapter. Files open through the API (permission check, then a signed URL). */
export function MaterialList({ staff = false }: { staff?: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const list = useQuery({ queryKey: ['materials'], queryFn: () => api<{ items: MaterialRow[] }>('/materials') });
  const del = useMutation({
    mutationFn: (id: string) => api(`/materials/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['materials'] }),
    onError: (e) => setError(errMsg(e)),
  });
  const items = list.data?.items ?? [];
  const byCourse = new Map<string, Map<string, MaterialRow[]>>();
  for (const m of items) {
    const c = m.course ?? 'General';
    const ch = m.chapter ?? 'No chapter';
    const chapters = byCourse.get(c) ?? new Map<string, MaterialRow[]>();
    chapters.set(ch, [...(chapters.get(ch) ?? []), m]);
    byCourse.set(c, chapters);
  }
  return (
    <div className="flex flex-col gap-4">
      {error && <p role="alert" className="text-base text-red-700">{error}</p>}
      {list.isPending && <ListSkeleton />}
      {list.isError && <ErrorState message={errMsg(list.error)} onRetry={() => void list.refetch()} />}
      {list.data && items.length === 0 && <EmptyState title="No notes yet" hint="Notes and study materials appear here when they are shared with you." />}
      {[...byCourse.entries()].map(([course, chapters]) => (
        <section key={course} className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">{course}</h2>
          {[...chapters.entries()].map(([chapter, rows]) => (
            <div key={chapter} className="flex flex-col gap-2">
              <h3 className="text-base font-semibold text-slate-700">{chapter}</h3>
              {rows.map((m) => (
                <Card key={m.id} data-testid={`material-${m.id}`} className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-lg font-semibold">{m.title}</p>
                      {m.description && <p className="text-base text-slate-600">{m.description}</p>}
                    </div>
                    {m.scope !== 'offering' && <Badge tone="amber">{SCOPE_LABEL[m.scope]}</Badge>}
                  </div>
                  {m.linkUrl && <a href={m.linkUrl} target="_blank" rel="noopener noreferrer nofollow" className="min-h-11 break-all py-2 text-base text-indigo-700 underline">{m.linkUrl}</a>}
                  <ul className="flex flex-col gap-1">
                    {m.files.map((f) => (
                      <li key={f.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-base">{f.name} <span className="text-sm text-slate-500">{bytes(f.size)}</span></span>
                        <span className="flex gap-1">
                          {f.inline && <a href={materialFileHref(m.id, f.id)} target="_blank" rel="noopener" className="flex min-h-11 items-center rounded-lg px-3 text-base font-medium text-indigo-700 hover:bg-indigo-50">View</a>}
                          <a href={materialFileHref(m.id, f.id, 'download')} className="flex min-h-11 items-center rounded-lg px-3 text-base font-medium text-indigo-700 hover:bg-indigo-50">Download</a>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {staff && m.mine && <StatsLine id={m.id} />}
                  {staff && m.mine && <Button variant="ghost" disabled={del.isPending} onClick={() => del.mutate(m.id)}>Delete</Button>}
                </Card>
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
