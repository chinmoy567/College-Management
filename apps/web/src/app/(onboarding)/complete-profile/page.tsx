'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { HOME, type MeUser } from '@/lib/auth';
import { Button, Card, Field, Input, ListSkeleton } from '@/components/ui';

/** First login for a Teacher or Student: choose a new password and add a mobile number (PRD §4.3). */
export default function CompleteProfile() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ user: MeUser }>('/auth/me'), retry: false });
  const [pw, setPw] = useState('');
  const [mobile, setMobile] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const user = me.data?.user;
  useEffect(() => {
    if (me.isError) window.location.assign('/login');
    else if (user && (user.role === 'admin' ? true : !user.firstLogin)) window.location.assign(user.role === 'admin' ? '/admin/setup' : HOME[user.role]);
  }, [me.isError, user]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api('/me/complete-profile', { method: 'POST', json: { newPassword: pw, mobile } });
      window.location.assign(HOME[user!.role]);
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...(err.fields ?? {}), form: err.fields ? '' : err.message });
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <main className="mx-auto max-w-md p-4"><ListSkeleton /></main>;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <Card className="flex flex-col gap-4 p-5">
        <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
        <p className="text-base text-slate-700">Choose a new password and add your mobile number to continue.</p>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="New password" hint="At least 8 characters. Not your initial password." error={errors.newPassword}>
            <Input type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label="Mobile number" hint="For example 01712345678" error={errors.mobile}>
            <Input type="tel" inputMode="tel" autoComplete="tel" required value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </Field>
          {errors.form && <p role="alert" className="text-base text-red-700">{errors.form}</p>}
          <Button type="submit" disabled={busy || !pw || !mobile}>{busy ? 'Saving…' : 'Continue'}</Button>
        </form>
      </Card>
    </main>
  );
}
