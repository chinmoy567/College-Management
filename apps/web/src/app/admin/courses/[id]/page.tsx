'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { chapterBody } from '@cms/shared';
import { api } from '@/lib/api';
import { errMsg, fieldErrors, type Course } from '@/lib/queries';
import { Button, Card, EmptyState, ErrorState, Field, Input, ListSkeleton, PageTitle } from '@/components/ui';

interface Chapter {
  id: string;
  name: string;
  order: number;
}

export default function CourseDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const courses = useQuery({ queryKey: ['courses'], queryFn: () => api<{ items: Course[] }>('/academics/courses') });
  const ch = useQuery({ queryKey: ['chapters', id], queryFn: () => api<{ items: Chapter[] }>(`/academics/courses/${id}/chapters`) });
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const reload = () => void qc.invalidateQueries({ queryKey: ['chapters', id] });
  const add = useMutation({
    mutationFn: (n: string) => api(`/academics/courses/${id}/chapters`, { method: 'POST', json: { name: n } }),
    onSuccess: () => {
      setName('');
      setErr('');
      reload();
    },
    onError: (e) => setErr(fieldErrors(e).name === 'duplicate' ? 'This course already has that chapter.' : errMsg(e)),
  });
  const remove = useMutation({ mutationFn: (cid: string) => api(`/academics/chapters/${cid}`, { method: 'DELETE' }), onSuccess: reload });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api(`/academics/courses/${id}/chapters/order`, { method: 'PUT', json: { ids } }),
    onSuccess: reload,
  });
  const course = courses.data?.items.find((c) => c.id === id);
  const items = ch.data?.items ?? [];
  const move = (i: number, d: -1 | 1) => {
    const ids = items.map((c) => c.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids);
  };
  return (
    <>
      <PageTitle>{course ? course.name : 'Course'}</PageTitle>
      <form
        className="mb-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const p = chapterBody.safeParse({ name });
          if (!p.success) return setErr('Enter a chapter name.');
          add.mutate(p.data.name);
        }}
      >
        <Field label="New chapter" error={err}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button type="submit" disabled={add.isPending}>
          Add chapter
        </Button>
      </form>
      {ch.isPending ? (
        <ListSkeleton />
      ) : ch.isError ? (
        <ErrorState message={errMsg(ch.error)} onRetry={() => void ch.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="No chapters yet" />
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((c, i) => (
            <li key={c.id}>
              <Card className="flex flex-col gap-2">
                <p className="text-base font-semibold">
                  {i + 1}. {c.name}
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    Up
                  </Button>
                  <Button variant="secondary" aria-label={`Move ${c.name} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                    Down
                  </Button>
                  <Button variant="ghost" aria-label={`Delete ${c.name}`} onClick={() => remove.mutate(c.id)}>
                    Delete
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
