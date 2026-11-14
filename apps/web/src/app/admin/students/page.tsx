'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg, groupLabel, sectionLabel, type SectionDetail, type SessionRow } from '@/lib/queries';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, ListSkeleton, PageTitle, Select } from '@/components/ui';

interface Hit {
  id: string;
  name: string;
  loginId: string | null;
  roll: string;
  status: string;
}

export default function StudentsPage() {
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ items: SessionRow[] }>('/academics/sessions') });
  const [sectionId, setSectionId] = useState('');
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const section = useQuery({ queryKey: ['section', sectionId], enabled: !!sectionId, queryFn: () => api<SectionDetail>(`/academics/sections/${sectionId}`) });
  const search = useQuery({
    queryKey: ['student-search', debounced],
    enabled: debounced.length > 0,
    queryFn: () => api<{ items: Hit[] }>(`/admin/students/search?q=${encodeURIComponent(debounced)}`),
  });
  const options = (sessions.data?.items ?? []).flatMap((s) => s.groups.flatMap((g) => g.sections.map((x) => ({ id: x.id, label: `${s.name} · ${groupLabel(g.type)} · ${sectionLabel(x)}` }))));
  const cards: Hit[] | undefined = debounced ? search.data?.items : section.data?.students.map((s) => ({ ...s }));
  const busy = debounced ? search.isPending : !!sectionId && section.isPending;
  const error = debounced ? search.error : section.error;
  return (
    <>
      <PageTitle action={<Link href="/admin/students/new"><Button>Add student</Button></Link>}>Students</PageTitle>
      <div className="mb-4 flex flex-col gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setDebounced(term.trim());
          }}
        >
          <Field label="Search by name, login ID, roll or mobile">
            <Input type="search" value={term} onChange={(e) => { setTerm(e.target.value); if (!e.target.value) setDebounced(''); }} enterKeyHint="search" />
          </Field>
        </form>
        <Field label="Or browse a section">
          <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            <option value="">Choose a section</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex gap-2">
          <Link href="/admin/students/import" className="flex-1"><Button variant="secondary" className="w-full">Import CSV</Button></Link>
        </div>
      </div>
      {!debounced && !sectionId ? (
        <EmptyState title="Search or pick a section" hint="Students appear here as cards." />
      ) : busy ? (
        <ListSkeleton />
      ) : error ? (
        <ErrorState message={errMsg(error)} />
      ) : !cards || cards.length === 0 ? (
        <EmptyState title="No students found" />
      ) : (
        <ul className="flex flex-col gap-3">
          {cards.map((s) => (
            <li key={s.id}>
              <Link href={`/admin/students/${s.id}`}>
                <Card className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold">{s.name}</p>
                    <p className="text-base text-slate-600">Roll {s.roll} · {s.loginId}</p>
                  </div>
                  {s.status !== 'active' && <Badge>{s.status}</Badge>}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
