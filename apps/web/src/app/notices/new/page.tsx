'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Button, Card, ErrorState, Field, Input, ListSkeleton, PageTitle, Select } from '@/components/ui';
import { CommunityShell } from '@/components/community/CommunityShell';
import type { Me } from '@/lib/community';

interface Options {
  sessions: { id: string; name: string; groups: { id: string; type: string }[] }[];
  offerings: { id: string; label: string }[];
  sections: { id: string; label: string }[];
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Plain text to simple paragraphs; the server sanitises again with its allow-list. */
const toHtml = (t: string) => t.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

function Composer({ me }: { me: Me }) {
  const router = useRouter();
  const opts = useQuery({ queryKey: ['notice-options'], queryFn: () => api<Options>('/notices/audience-options') });
  const isAdmin = me.role === 'admin';
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState('normal');
  const [publishAt, setPublishAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [landing, setLanding] = useState(false);
  const [aud, setAud] = useState<'all' | 'role' | 'session'>('all');
  const [role, setRole] = useState<'student' | 'teacher' | ''>('');
  const [sessionId, setSessionId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const audience = () => {
    if (!isAdmin) return { offeringIds: picked.filter((p) => opts.data?.offerings.some((o) => o.id === p)), sectionIds: picked.filter((p) => opts.data?.sections.some((s) => s.id === p)) };
    if (aud === 'all') return { all: true };
    return { ...(role ? { roles: [role] } : {}), ...(sessionId ? { sessionIds: [sessionId] } : {}), ...(groupId ? { groupIds: [groupId] } : {}) };
  };
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const a = audience() as Record<string, unknown>;
      for (const k of ['offeringIds', 'sectionIds']) if (Array.isArray(a[k]) && !(a[k] as unknown[]).length) delete a[k];
      const fd = new FormData();
      fd.append('scope', isAdmin ? 'central' : 'class');
      fd.append('audience', JSON.stringify(a));
      fd.append('title', title);
      fd.append('bodyHtml', toHtml(body));
      fd.append('priority', priority);
      if (publishAt) fd.append('publishAt', new Date(publishAt).toISOString());
      if (expiresAt) fd.append('expiresAt', new Date(expiresAt).toISOString());
      if (isAdmin && landing) fd.append('showOnLanding', 'true');
      for (const f of files) fd.append('attachments', f);
      const res = await fetch('/api/notices', { method: 'POST', body: fd, headers: { 'X-Requested-With': 'cms' }, credentials: 'same-origin' });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message: string; fields?: Record<string, string> } } | null;
        throw new ApiError('VALIDATION_ERROR', res.status, j?.error?.message ?? 'Could not publish.', j?.error?.fields);
      }
      router.push('/notices');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not publish.');
      setBusy(false);
    }
  };

  if (me.role === 'student') return <ErrorState message="Students cannot publish notices." />;
  if (opts.isPending) return <ListSkeleton />;
  if (opts.isError) return <ErrorState onRetry={() => void opts.refetch()} />;
  const group = opts.data.sessions.find((s) => s.id === sessionId)?.groups ?? [];
  return (
    <>
      <PageTitle>New notice</PageTitle>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Title"><Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required /></Field>
        <Field label="Notice">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} required className="w-full rounded-lg border border-slate-300 p-3 text-base" />
        </Field>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="normal">Normal</option>
            <option value="important">Important (also emailed)</option>
            <option value="urgent">Urgent (emailed, banner until read)</option>
          </Select>
        </Field>
        {isAdmin ? (
          <Card className="flex flex-col gap-3">
            <Field label="Who gets it">
              <Select value={aud} onChange={(e) => setAud(e.target.value as typeof aud)}>
                <option value="all">Everyone</option>
                <option value="role">Filter by role, session or group</option>
              </Select>
            </Field>
            {aud === 'role' && (
              <>
                <Field label="Role">
                  <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                    <option value="">Students and teachers</option>
                    <option value="student">Students</option>
                    <option value="teacher">Teachers</option>
                  </Select>
                </Field>
                <Field label="Session">
                  <Select value={sessionId} onChange={(e) => { setSessionId(e.target.value); setGroupId(''); }}>
                    <option value="">Any session</option>
                    {opts.data.sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </Field>
                {sessionId && (
                  <Field label="Group">
                    <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                      <option value="">Any group</option>
                      {group.map((g) => <option key={g.id} value={g.id}>{g.type}</option>)}
                    </Select>
                  </Field>
                )}
              </>
            )}
            <label className="flex min-h-11 items-center gap-2 text-base"><input type="checkbox" className="size-5" checked={landing} onChange={(e) => setLanding(e.target.checked)} /> Show on public landing page (attachments become public)</label>
          </Card>
        ) : (
          <Card className="flex flex-col gap-2">
            <p className="text-base font-medium">Send to</p>
            {[...opts.data.offerings.map((o) => ({ ...o, kind: 'Offering' })), ...opts.data.sections.map((s) => ({ ...s, kind: 'Section' }))].map((o) => (
              <label key={o.id} className="flex min-h-11 items-center gap-2 text-base">
                <input type="checkbox" className="size-5" checked={picked.includes(o.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, o.id] : p.filter((x) => x !== o.id)))} />
                {o.kind}: {o.label}
              </label>
            ))}
            {opts.data.offerings.length + opts.data.sections.length === 0 && <p className="text-base text-slate-600">You have no offerings or sections yet.</p>}
          </Card>
        )}
        <Field label="Publish at (leave empty to publish now)"><Input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} /></Field>
        <Field label="Expires at (optional)"><Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></Field>
        <Field label="Attachments (PDF or image, up to 5)" hint={files.length ? `${files.length} selected` : undefined}>
          <input type="file" multiple accept="image/*,application/pdf" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} className="text-base" />
        </Field>
        {error && <p role="alert" className="text-base text-red-700">{error}</p>}
        <Button type="submit" disabled={busy || !title.trim() || !body.trim()}>{publishAt ? 'Schedule notice' : 'Publish notice'}</Button>
      </form>
    </>
  );
}

export default function NewNoticePage() {
  return <CommunityShell>{(me) => <Composer me={me} />}</CommunityShell>;
}
