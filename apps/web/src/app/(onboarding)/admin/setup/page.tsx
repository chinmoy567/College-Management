'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { MeUser } from '@/lib/auth';
import { Button, Card, Field, Input, ListSkeleton } from '@/components/ui';

/** Admin first login: the seed password must be changed before anything else (PRD §4.2). */
export default function AdminSetup() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ user: MeUser }>('/auth/me'), retry: false });
  const user = me.data?.user;

  useEffect(() => {
    if (me.isError) window.location.assign('/login?role=admin');
    else if (user && user.role !== 'admin') window.location.assign('/login');
    else if (user && !user.mustChangePassword) window.location.assign('/admin');
  }, [me.isError, user]);

  if (!user || user.role !== 'admin' || !user.mustChangePassword) return <main className="mx-auto max-w-md p-4"><ListSkeleton /></main>;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <Card className="flex flex-col gap-4 p-5">
        <ChangePassword done={() => qc.invalidateQueries({ queryKey: ['me'] })} />
      </Card>
    </main>
  );
}

function ChangePassword({ done }: { done: () => void }) {
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/admin/change-password', { method: 'POST', json: { currentPassword: cur, newPassword: pw } });
      done();
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields?.newPassword ?? err.message) : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      <p className="text-base text-slate-700">You are using the password you were given. Set your own password to continue.</p>
      <Field label="Current password"><Input type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
      <Field label="New password" hint="At least 8 characters."><Input type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      {error && <p role="alert" className="text-base text-red-700">{error}</p>}
      <Button type="submit" disabled={busy || !cur || !pw}>{busy ? 'Saving…' : 'Save password'}</Button>
    </form>
  );
}
