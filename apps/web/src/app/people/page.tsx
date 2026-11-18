'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, ListSkeleton, PageTitle, Select } from '@/components/ui';
import { CommunityShell } from '@/components/community/CommunityShell';
import type { Author } from '@/lib/community';

interface Filters {
  sessions: { id: string; name: string; groups: { id: string; type: 'science' | 'commerce' | 'arts'; sections: { id: string; name: string; classLevel: number }[] }[] }[];
}
const GROUP = { science: 'Science', commerce: 'Commerce', arts: 'Arts' } as const;

function People() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<'all' | 'student' | 'teacher'>('all');
  const [sessionId, setSessionId] = useState('');
  const [group, setGroup] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [page, setPage] = useState(0);
  const [err, setErr] = useState('');

  const filters = useQuery({ queryKey: ['people-filters'], queryFn: () => api<Filters>('/chat/people/filters') });
  const session = filters.data?.sessions.find((s) => s.id === sessionId);
  const sections = (session?.groups ?? []).filter((g) => !group || g.type === group).flatMap((g) => g.sections.map((s) => ({ ...s, group: g.type })));
  const name = q.trim();
  const ready = name.length >= 2 || Boolean(sessionId || group || sectionId);
  const params = new URLSearchParams({ role, page: String(page) });
  if (name.length >= 2) params.set('q', name);
  if (sessionId) params.set('sessionId', sessionId);
  if (group) params.set('group', group);
  if (sectionId) params.set('sectionId', sectionId);
  const people = useQuery({
    queryKey: ['people', params.toString()],
    queryFn: () => api<{ items: Author[]; hasMore: boolean }>(`/chat/people?${params.toString()}`),
    enabled: ready,
  });
  const reset = () => setPage(0);
  const start = async (userId: string) => {
    try {
      const r = await api<{ id: string }>('/chat/direct', { method: 'POST', json: { userId } });
      router.push(`/messages/${r.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not start the chat.');
    }
  };

  return (
    <>
      <PageTitle>Find people</PageTitle>
      <Card className="mb-3 flex flex-col gap-3">
        <Field label="Name">
          <Input placeholder="Search by name" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
        </Field>
        <Field label="Who">
          <Select value={role} onChange={(e) => { setRole(e.target.value as typeof role); reset(); }}>
            <option value="all">Students and teachers</option>
            <option value="student">Students</option>
            <option value="teacher">Teachers</option>
          </Select>
        </Field>
        <Field label="Session">
          <Select value={sessionId} onChange={(e) => { setSessionId(e.target.value); setGroup(''); setSectionId(''); reset(); }}>
            <option value="">Any session</option>
            {filters.data?.sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Department (group)">
          <Select value={group} onChange={(e) => { setGroup(e.target.value); setSectionId(''); reset(); }}>
            <option value="">Any department</option>
            {(Object.keys(GROUP) as (keyof typeof GROUP)[]).map((g) => <option key={g} value={g}>{GROUP[g]}</option>)}
          </Select>
        </Field>
        <Field label="Section" hint={!sessionId ? 'Pick a session first.' : undefined}>
          <Select value={sectionId} disabled={!sessionId} onChange={(e) => { setSectionId(e.target.value); reset(); }}>
            <option value="">Any section</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{GROUP[s.group]} · Class {s.classLevel} · {s.name}</option>)}
          </Select>
        </Field>
      </Card>
      {err && <p role="alert" className="mb-2 text-base text-red-700">{err}</p>}
      {!ready && <EmptyState title="Search for someone" hint="Type 2 letters of a name or pick a session, department or section." />}
      {ready && people.isFetching && <ListSkeleton rows={3} />}
      {people.isError && <ErrorState onRetry={() => void people.refetch()} />}
      {people.isSuccess && people.data.items.length === 0 && <EmptyState title="No one found" hint="Try different filters." />}
      <div className="flex flex-col gap-2">
        {people.data?.items.map((p) => (
          <Card key={p.id} className="flex min-h-11 items-center justify-between gap-3" data-testid="person">
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{p.name}</p>
              <p className="truncate text-base text-slate-600">{p.line}</p>
              {p.role && <Badge>{p.role === 'teacher' ? 'Teacher' : 'Student'}</Badge>}
            </div>
            <Button className="shrink-0" onClick={() => p.id && void start(p.id)}>Message</Button>
          </Card>
        ))}
      </div>
      {people.data && (page > 0 || people.data.hasMore) && (
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" className="flex-1" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button variant="secondary" className="flex-1" disabled={!people.data.hasMore} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </>
  );
}

export default function PeoplePage() {
  return <CommunityShell>{() => <People />}</CommunityShell>;
}
