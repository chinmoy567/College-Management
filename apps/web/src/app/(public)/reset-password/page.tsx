'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button, Card, Field, Input } from '@/components/ui';

function Form() {
  const token = useSearchParams().get('token') ?? '';
  const [pw, setPw] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/password/reset', { method: 'POST', json: { token, newPassword: pw } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields?.newPassword ?? err.message) : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <Card className="flex flex-col gap-4 p-5">
        <h1 className="text-2xl font-semibold">Set a new password</h1>
        {done ? (
          <>
            <p role="status" className="text-base">Password changed. You can log in now.</p>
            <Link href="/login" className="flex min-h-11 items-center text-base font-medium text-indigo-700">Go to login</Link>
          </>
        ) : !token ? (
          <p role="alert" className="text-base text-red-700">This link is not valid. Ask for a new one.</p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="New password" hint="Choose a strong password.">
              <Input type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
            {error && <p role="alert" className="text-base text-red-700">{error}</p>}
            <Button type="submit" disabled={busy || !pw}>{busy ? 'Saving…' : 'Change password'}</Button>
          </form>
        )}
      </Card>
    </main>
  );
}

export default function ResetPassword() {
  return (
    <Suspense>
      <Form />
    </Suspense>
  );
}
