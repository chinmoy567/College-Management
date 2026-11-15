'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { HOME, type Role } from '@/lib/auth';
import { Button, Card, Field, Input } from '@/components/ui';

const LABEL: Record<string, string> = { student: 'Student', teacher: 'Teacher', admin: 'Admin' };

function LoginForm() {
  const roleHint = useSearchParams().get('role') ?? '';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const go = (next: string, role?: Role) => {
    if (next === 'complete_profile') return window.location.assign('/complete-profile');
    if (next === 'change_password') return window.location.assign('/admin/setup');
    window.location.assign(HOME[role ?? 'admin']);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ next: string; role?: Role; roleMismatch?: boolean }>('/auth/login', {
        method: 'POST', json: { identifier: identifier.trim(), password, ...(roleHint ? { roleHint } : {}) },
      });
      if (r.roleMismatch && r.role) {
        setNotice(`You signed in as a ${LABEL[r.role]}. Taking you to your dashboard.`);
        setTimeout(() => go(r.next, r.role), 1200);
      } else go(r.next, r.role);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <Link href="/" className="min-h-11 text-base text-indigo-700">← Back to home</Link>
      <Card className="flex flex-col gap-4 p-5">
        <h1 className="text-2xl font-semibold">{LABEL[roleHint] ? `${LABEL[roleHint]} login` : 'Login'}</h1>
        {notice && <p role="status" className="rounded-lg bg-amber-50 p-3 text-base text-amber-900">{notice}</p>}
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="User ID or Email">
            <Input name="identifier" autoComplete="username" autoCapitalize="none" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
          </Field>
          <Field label="Password">
            <div className="flex gap-2">
              <Input name="password" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button variant="secondary" aria-pressed={show} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</Button>
            </div>
          </Field>
          {error && <p role="alert" className="text-base text-red-700">{error}</p>}
          <Button type="submit" disabled={busy || !identifier}>{busy ? 'Please wait…' : 'Log in'}</Button>
        </form>
        <Link href="/forgot-password" className="flex min-h-11 items-center text-base text-indigo-700">Forgot password?</Link>
      </Card>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
