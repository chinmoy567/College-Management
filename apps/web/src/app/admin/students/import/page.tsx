'use client';

import { useState } from 'react';
import { Badge, Button, Card, Field, PageTitle } from '@/components/ui';

interface RowError {
  row: number;
  field: string;
  message: string;
}
interface Dry {
  total: number;
  valid: number;
  errors: RowError[];
}

const post = (file: File, dry: boolean) => {
  const fd = new FormData();
  fd.append('file', file);
  return fetch(`/api/users/import/students${dry ? '?dryRun=true' : ''}`, { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Requested-With': 'cms' } });
};

export default function ImportStudents() {
  const [file, setFile] = useState<File | null>(null);
  const [dry, setDry] = useState<Dry | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState<{ created: number; token: string } | null>(null);

  const readError = async (res: Response): Promise<RowError[]> => {
    const b = (await res.json().catch(() => null)) as { error?: { message: string }; errors?: RowError[] } | null;
    if (b?.errors) return b.errors;
    setMsg(b?.error?.message ?? 'The upload failed.');
    return [];
  };
  const run = async (isDry: boolean) => {
    if (!file) return;
    setBusy(true);
    setMsg('');
    try {
      const res = await post(file, isDry);
      if (isDry) {
        if (res.ok) setDry((await res.json()) as Dry);
        else setDry({ total: 0, valid: 0, errors: await readError(res) });
      } else if (res.ok) {
        const b = (await res.json()) as { created: number; slipToken: string };
        setDone({ created: b.created, token: b.slipToken });
      } else {
        setDry({ total: dry?.total ?? 0, valid: 0, errors: await readError(res) });
      }
    } catch {
      setMsg('Network problem. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <>
        <PageTitle>Import finished</PageTitle>
        <Card className="flex flex-col gap-3">
          <p className="text-lg font-semibold">{done.created} students created.</p>
          <p className="text-base text-slate-600">Download the slips now. They are available once for a short time and passwords are never shown again.</p>
          <a href={`/api/users/import/slips/${done.token}?format=pdf`}>
            <Button className="w-full">Download slips (PDF)</Button>
          </a>
          <a href={`/api/users/import/slips/${done.token}?format=csv`}>
            <Button variant="secondary" className="w-full">Download slips (CSV)</Button>
          </a>
        </Card>
      </>
    );

  return (
    <>
      <PageTitle>Import students</PageTitle>
      <div className="flex flex-col gap-4">
        <Card className="text-base text-slate-700">
          CSV columns: <code>name, roll, session, group, section</code>, plus an optional <code>email</code> column. Up to 1000 rows. One bad row imports nothing.
        </Card>
        <Field label="CSV file">
          <input
            type="file"
            accept=".csv,text/csv"
            className="min-h-11 text-base"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setDry(null);
            }}
          />
        </Field>
        <Button variant="secondary" disabled={!file || busy} onClick={() => void run(true)}>
          {busy ? 'Checking…' : 'Check file (dry run)'}
        </Button>
        {msg && <p role="alert" className="text-base text-red-700">{msg}</p>}
        {dry && (
          <section aria-label="Dry run result" className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Badge tone={dry.errors.length ? 'red' : 'green'}>{dry.errors.length ? `${dry.errors.length} errors` : 'No errors'}</Badge>
              <span className="text-base">{dry.valid} of {dry.total} rows valid</span>
            </div>
            {dry.errors.length > 0 && (
              <ul className="flex flex-col gap-2">
                {dry.errors.map((e, i) => (
                  <li key={i}>
                    <Card className="border-red-200">
                      <p className="text-base font-semibold">Row {e.row} · {e.field}</p>
                      <p className="text-base text-red-800">{e.message}</p>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
            {dry.errors.length === 0 && dry.total > 0 && (
              <Button disabled={busy} onClick={() => void run(false)}>
                Import {dry.total} students
              </Button>
            )}
          </section>
        )}
      </div>
    </>
  );
}
