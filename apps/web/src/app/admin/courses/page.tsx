'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { courseBody } from '@cms/shared';
import { api } from '@/lib/api';
import { errMsg, fieldErrors, groupLabel, type Course } from '@/lib/queries';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, ListSkeleton, PageTitle, Select, Sheet } from '@/components/ui';

const classLabel = (c: string) => (c === 'c11' ? 'Class 11' : c === 'c12' ? 'Class 12' : 'Class 11 and 12');

export default function CoursesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['courses'], queryFn: () => api<{ items: Course[] }>('/academics/courses') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: '', name: '', groupType: 'common', classLevel: 'both', isOptional: false });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: (body: unknown) => api('/academics/courses', { method: 'POST', json: body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['courses'] });
      setOpen(false);
      setF({ code: '', name: '', groupType: 'common', classLevel: 'both', isOptional: false });
    },
    onError: (e) => setErrs({ form: errMsg(e), ...(fieldErrors(e).code ? { code: 'This code already exists.' } : {}) }),
  });
  const submit = () => {
    const p = courseBody.safeParse(f);
    if (!p.success) {
      const m: Record<string, string> = {};
      for (const i of p.error.issues) m[String(i.path[0])] = i.message;
      return setErrs(m);
    }
    setErrs({});
    create.mutate(p.data);
  };
  return (
    <>
      <PageTitle action={<Button onClick={() => setOpen(true)}>Add course</Button>}>Course catalog</PageTitle>
      {q.isPending ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState title="No courses yet" hint="Add the courses your college teaches." />
      ) : (
        <ul className="flex flex-col gap-3">
          {q.data.items.map((c) => (
            <li key={c.id}>
              <Link href={`/admin/courses/${c.id}`}>
                <Card className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold">{c.name}</p>
                    <p className="text-base text-slate-600">
                      {c.code} · {c.groupType === 'common' ? 'All groups' : groupLabel(c.groupType)} · {classLabel(c.classLevel)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {c.isOptional && <Badge tone="amber">Optional</Badge>}
                    {c.archivedAt && <Badge>Archived</Badge>}
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={open} title="Add course" onClose={() => setOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Code" error={errs.code}>
            <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} autoCapitalize="characters" />
          </Field>
          <Field label="Name" error={errs.name}>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Group">
            <Select value={f.groupType} onChange={(e) => setF({ ...f, groupType: e.target.value })}>
              <option value="common">All groups</option>
              <option value="science">Science</option>
              <option value="commerce">Commerce</option>
              <option value="arts">Arts</option>
            </Select>
          </Field>
          <Field label="Class">
            <Select value={f.classLevel} onChange={(e) => setF({ ...f, classLevel: e.target.value })}>
              <option value="both">Class 11 and 12</option>
              <option value="c11">Class 11</option>
              <option value="c12">Class 12</option>
            </Select>
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-base">
            <input type="checkbox" className="size-6" checked={f.isOptional} onChange={(e) => setF({ ...f, isOptional: e.target.checked })} />
            Optional course
          </label>
          {errs.form && <p role="alert" className="text-base text-red-700">{errs.form}</p>}
          <Button type="submit" disabled={create.isPending}>
            Save course
          </Button>
        </form>
      </Sheet>
    </>
  );
}
