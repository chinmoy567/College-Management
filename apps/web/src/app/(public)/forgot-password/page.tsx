'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button, Card, Field, Input } from '@/components/ui';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setMsg((await api<{ message: string }>('/auth/password/forgot', { method: 'POST', json: { email: email.trim().toLowerCase() } })).message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <Link href="/login" className="min-h-11 text-base text-indigo-700">← Back to login</Link>
      <Card className="flex flex-col gap-4 p-5">
        <h1 className="text-2xl font-semibold">Forgot password</h1>
        {msg ? (
          <p role="status" className="text-base">{msg}</p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Your verified email">
              <Input type="email" inputMode="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            {error && <p role="alert" className="text-base text-red-700">{error}</p>}
            <Button type="submit" disabled={busy || !email}>{busy ? 'Sending…' : 'Send reset link'}</Button>
          </form>
        )}
      </Card>
    </main>
  );
}
