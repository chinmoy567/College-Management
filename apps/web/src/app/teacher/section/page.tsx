'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { formatDhakaDate } from '@/lib/dhaka';
import { FLAG_LABEL, pct, type MentorFlag, type MentorOverview, type MentorStudent, type MentorStudentDetail } from '@/lib/mentor';
import { Badge, Button, Card, EmptyState, ErrorState, Input, ListSkeleton, PageTitle, Sheet } from '@/components/ui';

const FILTERS: { key: 'all' | MentorFlag; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'low_attendance', label: 'Low attendance' },
  { key: 'below_pass', label: 'Below pass' },
  { key: 'inactive', label: 'Inactive' },
];
const tone = (f: MentorFlag) => (f === 'inactive' ? 'slate' : 'red');

function Avatar({ s }: { s: Pick<MentorStudent, 'name' | 'avatarUrl'> }) {
  return s.avatarUrl
    ? <img src={s.avatarUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
    : <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-base font-semibold text-indigo-700">{s.name.trim().charAt(0).toUpperCase() || '?'}</span>;
}

/** Section Mentor workspace (PRD 5.2.2a, spec 03 §7a): only the mentor's own section. */
export default function MySection() {
  const overview = useQuery({ queryKey: ['mentor-section'], queryFn: () => api<MentorOverview>('/mentor/section'), retry: false });
  const list = useQuery({ queryKey: ['mentor-students'], queryFn: () => api<{ items: MentorStudent[] }>('/mentor/section/students'), retry: false, enabled: overview.isSuccess });
  const [filter, setFilter] = useState<'all' | MentorFlag>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  if (overview.isPending) return <ListSkeleton />;
  if (overview.error instanceof ApiError && overview.error.status === 403)
    return (<><PageTitle>My Section</PageTitle><EmptyState title="You are not a Section Mentor" hint="This page appears once the Admin makes you the mentor of a section." /></>);
  if (overview.isError) return <ErrorState message={errMsg(overview.error)} onRetry={() => void overview.refetch()} />;

  const o = overview.data;
  const s = o.summary;
  const q = search.trim().toLowerCase();
  const rows = (list.data?.items ?? []).filter((st) => (filter === 'all' || st.flags.includes(filter)) && (!q || st.name.toLowerCase().includes(q) || st.roll.toLowerCase().includes(q)));
  const stat = (label: string, value: string | number, f?: MentorFlag) => (
    <button key={label} type="button" disabled={!f} onClick={() => f && setFilter(filter === f ? 'all' : f)} data-testid={`stat-${f ?? 'students'}`} className="min-h-11 text-left disabled:cursor-default">
      <Card className={`h-full ${f && filter === f ? 'ring-2 ring-indigo-500' : ''}`}>
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-base text-slate-600">{label}</p>
      </Card>
    </button>
  );

  return (
    <>
      <PageTitle>My Section</PageTitle>
      <p className="mb-4 text-base text-slate-600">{o.section.session} · {o.section.group} · Class {o.section.classLevel} · Section {o.section.name}</p>

      <div className="mb-4 grid grid-cols-2 gap-3">
        {stat('Students', s.students)}
        {stat('Attendance', pct(s.attendancePct))}
        {stat('Low attendance', s.lowAttendance, 'low_attendance')}
        {stat('Below pass mark', s.belowPass, 'below_pass')}
        {stat(`Inactive (${o.thresholds.inactiveDays}+ days)`, s.inactive, 'inactive')}
      </div>

      <div className="mb-6 flex flex-col gap-2">
        {o.chatConversationId
          ? <Link href={`/messages/${o.chatConversationId}`} data-testid="open-group-chat" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-indigo-600 px-4 text-base font-medium text-white">Open section group chat</Link>
          : <p className="text-base text-slate-600">The section group chat is not created yet.</p>}
        <div className="grid grid-cols-2 gap-2">
          <Link href="/feed" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-100 px-4 text-base font-medium">New section post</Link>
          <Link href="/notices/new" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-100 px-4 text-base font-medium">New notice</Link>
        </div>
      </div>

      <h2 className="mb-2 text-xl font-semibold">Students</h2>
      <Input placeholder="Search by name or roll" aria-label="Search students" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-3" />
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter students">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} data-testid={`filter-${f.key}`}
            className={`min-h-11 rounded-full px-4 text-base font-medium ${filter === f.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800'}`}>{f.label}</button>
        ))}
      </div>

      {list.isPending && <ListSkeleton />}
      {list.isError && <ErrorState message={errMsg(list.error)} onRetry={() => void list.refetch()} />}
      {list.data && rows.length === 0 && <EmptyState title={list.data.items.length === 0 ? 'No students in this section yet' : 'No students match'} />}
      <div className="flex flex-col gap-3">
        {rows.map((st) => (
          <button key={st.id} type="button" onClick={() => setOpen(st.id)} data-testid={`student-${st.roll}`} className="min-h-11 text-left">
            <Card className="flex items-center gap-3">
              <Avatar s={st} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold">{st.name}</p>
                <p className="text-base text-slate-600">Roll {st.roll} · Attendance {pct(st.attendancePct)} · Exams {pct(st.examAvgPct)}</p>
                {st.flags.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{st.flags.map((f) => <Badge key={f} tone={tone(f)}>{FLAG_LABEL[f]}</Badge>)}</div>}
              </div>
            </Card>
          </button>
        ))}
      </div>

      <StudentSheet id={open} onClose={() => setOpen(null)} />
    </>
  );
}

function StudentSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const router = useRouter();
  const [err, setErr] = useState('');
  const q = useQuery({ queryKey: ['mentor-student', id], queryFn: () => api<MentorStudentDetail>(`/mentor/section/students/${id}`), enabled: !!id });
  const message = async () => {
    try {
      const r = await api<{ id: string }>('/chat/direct', { method: 'POST', json: { userId: id } });
      router.push(`/messages/${r.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not start the chat.');
    }
  };
  const d = q.data;
  return (
    <Sheet open={!!id} title={d?.name ?? 'Student'} onClose={onClose}>
      {q.isPending && <ListSkeleton rows={2} />}
      {q.isError && <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />}
      {d && (
        <div className="flex flex-col gap-4" data-testid="student-detail">
          <p className="text-base text-slate-700">Roll {d.roll}{d.loginId ? ` · ${d.loginId}` : ''}<br />{d.lastActiveAt ? `Last active ${formatDhakaDate(d.lastActiveAt)}` : 'Never logged in'}</p>
          {d.flags.length > 0 && <div className="flex flex-wrap gap-1">{d.flags.map((f) => <Badge key={f} tone={tone(f)}>{FLAG_LABEL[f]}</Badge>)}</div>}
          <section>
            <h3 className="mb-1 text-lg font-semibold">Attendance</h3>
            {d.attendance.length === 0 && <p className="text-base text-slate-600">No courses yet.</p>}
            {d.attendance.map((a) => <p key={a.offeringId} className="flex justify-between text-base"><span>{a.course}</span><span>{pct(a.pct)} ({a.present}/{a.held})</span></p>)}
          </section>
          <section>
            <h3 className="mb-1 text-lg font-semibold">Exams</h3>
            {d.exams.length === 0 && <p className="text-base text-slate-600">No published results yet.</p>}
            {d.exams.map((e) => (
              <p key={e.examId} className="flex items-center justify-between gap-2 text-base">
                <span className="min-w-0 truncate">{e.course} · {e.title}</span>
                <span className="shrink-0">{e.score === null ? 'Absent' : `${e.score}/${e.totalMarks}`} <Badge tone={e.passed ? 'green' : 'red'}>{e.passed ? 'Pass' : 'Below pass'}</Badge></span>
              </p>
            ))}
          </section>
          {err && <p role="alert" className="text-base text-red-700">{err}</p>}
          <Button onClick={() => void message()}>Message {d.name.split(' ')[0]}</Button>
        </div>
      )}
    </Sheet>
  );
}
