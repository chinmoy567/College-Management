'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { AppShell, Logout } from '@/components/AppShell';
import { Badge, Button, Card, ErrorState, Field, Input, ListSkeleton, PageTitle } from '@/components/ui';

interface Profile {
  loginId: string | null; email: string | null; emailVerified: boolean; mobile: string | null; role: 'admin' | 'teacher' | 'student';
  name?: string; nameLocked?: boolean; bio?: string | null; section?: string; session?: string; roll?: string; designation?: string | null;
}

function Edit({ p }: { p: Profile }) {
  const qc = useQueryClient();
  const [name, setName] = useState(p.name ?? '');
  const [mobile, setMobile] = useState(p.mobile ?? '');
  const [bio, setBio] = useState(p.bio ?? '');
  const [msg, setMsg] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function save(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    setErrors({});
    try {
      await api('/me/profile', { method: 'PATCH', json: { ...(p.nameLocked ? {} : { name }), mobile, bio: bio || null } });
      setMsg('Saved.');
      void qc.invalidateQueries({ queryKey: ['profile'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setErrors(err instanceof ApiError ? { ...(err.fields ?? {}), form: err.message } : { form: 'Something went wrong.' });
    }
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <Field label="Name" hint={p.nameLocked ? 'Locked. Ask the Admin to change it.' : undefined} error={errors.name}>
        <Input value={name} disabled={p.nameLocked} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Mobile" error={errors.mobile}><Input type="tel" inputMode="tel" autoComplete="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} /></Field>
      <Field label="Bio" error={errors.bio}>
        <textarea className="min-h-24 w-full rounded-lg border border-slate-300 p-3 text-base" maxLength={500} value={bio} onChange={(e) => setBio(e.target.value)} />
      </Field>
      {errors.form && <p role="alert" className="text-base text-red-700">{errors.form}</p>}
      {msg && <p role="status" className="text-base text-emerald-700">{msg}</p>}
      <Button type="submit">Save</Button>
    </form>
  );
}

function ChangePassword() {
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    setError('');
    try {
      await api('/me/password', { method: 'POST', json: { currentPassword: cur, newPassword: pw } });
      setMsg('Password changed. Your other devices were signed out.');
      setCur('');
      setPw('');
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields?.newPassword ?? err.message) : 'Something went wrong.');
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Current password"><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
      <Field label="New password"><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      {error && <p role="alert" className="text-base text-red-700">{error}</p>}
      {msg && <p role="status" className="text-base text-emerald-700">{msg}</p>}
      <Button type="submit" disabled={!cur || !pw}>Change password</Button>
    </form>
  );
}

function ChangeEmail() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    setError('');
    try {
      await api('/me/email', { method: 'POST', json: { newEmail: email.trim(), password: pw } });
      setMsg('We sent a link to the new address. Open it within 30 minutes to finish the change.');
      setEmail('');
      setPw('');
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields?.newEmail ?? err.message) : 'Something went wrong.');
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="New email"><Input type="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      {error && <p role="alert" className="text-base text-red-700">{error}</p>}
      {msg && <p role="status" className="text-base text-emerald-700">{msg}</p>}
      <Button type="submit" disabled={!email || !pw}>Change email</Button>
    </form>
  );
}

function Verified({ p }: { p: Profile }) {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('verified')) setMsg('Email verified.');
  }, []);
  if (!p.email) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-base">
      <span>{p.email}</span>
      <Badge tone={p.emailVerified ? 'green' : 'amber'}>{p.emailVerified ? 'Verified' : 'Not verified'}</Badge>
      {!p.emailVerified && (
        <Button variant="ghost" onClick={async () => setMsg(await api('/me/email/resend-verification', { method: 'POST' }).then(() => 'Verification email sent.', (e) => errMsg(e)))}>
          Resend link
        </Button>
      )}
      {msg && <span role="status" className="text-emerald-700">{msg}</span>}
    </div>
  );
}

function Body() {
  const q = useQuery({ queryKey: ['profile'], queryFn: () => api<{ profile: Profile }>('/me/profile') });
  if (q.isPending) return <ListSkeleton />;
  if (q.isError) return <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />;
  const p = q.data.profile;
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-1">
        <p className="text-xl font-semibold">{p.name ?? 'Admin'}</p>
        <p className="text-base capitalize text-slate-600">{p.role}{p.loginId ? ` · ${p.loginId}` : ''}</p>
        {p.section && <p className="text-base text-slate-600">{p.session} · {p.section}{p.roll ? ` · Roll ${p.roll}` : ''}</p>}
        <Verified p={p} />
      </Card>
      {p.role !== 'admin' && <Card><h2 className="mb-3 text-lg font-semibold">Edit profile</h2><Edit p={p} /></Card>}
      <Card><h2 className="mb-3 text-lg font-semibold">Change password</h2><ChangePassword /></Card>
      <Card><h2 className="mb-3 text-lg font-semibold">Change email</h2><ChangeEmail /></Card>
      <Logout />
    </div>
  );
}

export default function ProfilePage() {
  return (
    <AppShell>
      {() => (
        <>
          <PageTitle>My profile</PageTitle>
          <Body />
        </>
      )}
    </AppShell>
  );
}
