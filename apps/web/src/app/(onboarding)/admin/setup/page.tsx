'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { MeUser } from '@/lib/auth';
import { Button, Card, Field, Input, ListSkeleton } from '@/components/ui';

/** Admin first setup: new password, then authenticator QR, then one-time backup codes (PRD §4.2). */
export default function AdminSetup() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ user: MeUser }>('/auth/me'), retry: false });
  const [codes, setCodes] = useState<string[] | null>(null);
  const user = me.data?.user;

  useEffect(() => {
    if (me.isError) window.location.assign('/login?role=admin');
    else if (user && user.role !== 'admin') window.location.assign('/login');
    else if (user && !user.mustChangePassword && user.totpEnabled && !user.stepUpPending && !codes) window.location.assign('/admin');
    else if (user && user.totpEnabled && user.stepUpPending) window.location.assign('/login?role=admin');
  }, [me.isError, user, codes]);

  if (!user || user.role !== 'admin') return <main className="mx-auto max-w-md p-4"><ListSkeleton /></main>;
  const refresh = () => qc.invalidateQueries({ queryKey: ['me'] });
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <Card className="flex flex-col gap-4 p-5">
        {codes ? <Backup codes={codes} /> : user.mustChangePassword ? <ChangePassword done={refresh} /> : <Totp done={setCodes} />}
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
      <h1 className="text-2xl font-semibold">Step 1: new password</h1>
      <Field label="Current password"><Input type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
      <Field label="New password" hint="At least 8 characters."><Input type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      {error && <p role="alert" className="text-base text-red-700">{error}</p>}
      <Button type="submit" disabled={busy || !cur || !pw}>{busy ? 'Saving…' : 'Continue'}</Button>
    </form>
  );
}

function Totp({ done }: { done: (codes: string[]) => void }) {
  const qr = useQuery({ queryKey: ['totp-setup'], queryFn: () => api<{ otpauthUri: string; qrDataUrl: string }>('/auth/totp/setup', { method: 'POST' }), retry: false, staleTime: Infinity, refetchOnWindowFocus: false });
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      done((await api<{ backupCodes: string[] }>('/auth/totp/enable', { method: 'POST', json: { code: code.trim() } })).backupCodes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Step 2: two-step login</h1>
      <p className="text-base text-slate-700">Scan this QR code with an authenticator app, then enter the 6-digit code.</p>
      {qr.isPending ? <ListSkeleton rows={1} /> : qr.isError ? <p role="alert" className="text-base text-red-700">Could not start setup. Reload the page.</p> : (
        <img src={qr.data.qrDataUrl} alt="Authenticator QR code" width={200} height={200} className="mx-auto" />
      )}
      <Field label="6-digit code"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} /></Field>
      {error && <p role="alert" className="text-base text-red-700">{error}</p>}
      <Button type="submit" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Turn on'}</Button>
    </form>
  );
}

function Backup({ codes }: { codes: string[] }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Step 3: backup codes</h1>
      <p className="text-base text-slate-700">Save these codes now. Each works once if you lose your phone. They are not shown again.</p>
      <ul data-testid="backup-codes" className="grid grid-cols-2 gap-2 font-mono text-base">{codes.map((c) => <li key={c} className="rounded bg-slate-100 p-2 text-center">{c}</li>)}</ul>
      <label className="flex min-h-11 items-center gap-2 text-base"><input type="checkbox" className="h-5 w-5" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I saved these codes</label>
      <Button disabled={!saved} onClick={() => window.location.assign('/admin')}>Open dashboard</Button>
    </div>
  );
}
