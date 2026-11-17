'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg, fieldErrors } from '@/lib/queries';
import { GROUPS, taka, type AdminBookRow } from '@/lib/books';
import { uploadForm, type CourseRow } from '@/lib/learning';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, ListSkeleton, PageTitle, Select, Sheet } from '@/components/ui';

const STATUS_TONE = { published: 'green', processing: 'amber', archived: 'slate' } as const;

function BookForm({ book, onDone }: { book?: AdminBookRow; onDone: () => void }) {
  const qc = useQueryClient();
  const courses = useQuery({ queryKey: ['courses-lite'], queryFn: () => api<{ items: CourseRow[] }>('/academics/courses') });
  const [pct, setPct] = useState(0);
  const save = useMutation({
    mutationFn: (form: FormData) => uploadForm(book ? `/books/${book.id}` : '/books', form, setPct, book ? 'PATCH' : 'POST'),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin-books'] });
      onDone();
    },
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    // Empty file inputs must not be sent.
    for (const k of ['cover', 'pdf']) if (!(form.get(k) as File | null)?.size) form.delete(k);
    save.mutate(form);
  };
  const err = fieldErrors(save.error);
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Title" error={err.title}><Input name="title" required maxLength={200} defaultValue={book?.title} /></Field>
      <Field label="Author" error={err.author}><Input name="author" required maxLength={200} defaultValue={book?.author} /></Field>
      <Field label="Publisher (optional)"><Input name="publisher" maxLength={200} defaultValue={book?.publisher ?? ''} /></Field>
      <Field label="Price (৳)" error={err.price}><Input name="price" type="number" inputMode="decimal" min="0" step="0.01" required defaultValue={book?.price ?? ''} /></Field>
      <Field label="Course (optional)"><Select name="courseId" defaultValue={book?.courseId ?? ''}><option value="">No course</option>{courses.data?.items.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</Select></Field>
      <Field label="Group (optional)"><Select name="groupType" defaultValue={book?.groupType ?? ''}><option value="">Any</option>{GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      <Field label="Class (optional)"><Select name="classLevel" defaultValue={book?.classLevel ?? ''}><option value="">Any</option><option value="c11">Class 11</option><option value="c12">Class 12</option><option value="both">Both</option></Select></Field>
      <Field label="Description (optional)"><textarea name="description" rows={3} maxLength={4000} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base" /></Field>
      <Field label="Free preview pages" hint="For example 1-5,9. Leave empty for no preview." error={err.previewPages}><Input name="previewPages" maxLength={200} defaultValue={book?.previewPages.join(',') ?? ''} /></Field>
      <Field label={book ? 'Replace the cover (JPG, PNG, WebP, 5 MB)' : 'Cover (JPG, PNG, WebP, 5 MB)'}><Input name="cover" type="file" accept="image/jpeg,image/png,image/webp" /></Field>
      <Field label={book?.hasPdf ? 'Replace the PDF (up to 50 MB)' : 'Book PDF (optional, up to 50 MB)'} hint={book?.hasPdf ? undefined : 'You can add the PDF later by editing the book.'} error={err.pdf ?? err.files}><Input name="pdf" type="file" accept="application/pdf" /></Field>
      {save.isError && <p role="alert" className="text-base text-red-700">{errMsg(save.error)}</p>}
      {save.isPending && <p className="text-base text-slate-600">Uploading… {pct}%</p>}
      <Button type="submit" disabled={save.isPending}>{book ? 'Save changes' : 'Add book'}</Button>
    </form>
  );
}

export default function AdminBooks() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AdminBookRow | 'new' | null>(null);
  const list = useQuery({ queryKey: ['admin-books'], queryFn: () => api<{ items: AdminBookRow[] }>('/admin/books'), refetchInterval: (q) => (q.state.data?.items.some((b) => b.status === 'processing') ? 5000 : false) });
  const top = useQuery({ queryKey: ['admin-books-top'], queryFn: () => api<{ items: { bookId: string; title: string; unlocks: number }[] }>('/admin/books/reports/top') });
  const archive = useMutation({
    mutationFn: (id: string) => api(`/books/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-books'] }),
  });
  return (
    <>
      <PageTitle action={<Button onClick={() => setEditing('new')}>Add book</Button>}>Book shop</PageTitle>
      {list.isPending && <ListSkeleton />}
      {list.isError && <ErrorState message={errMsg(list.error)} onRetry={() => void list.refetch()} />}
      {list.data && list.data.items.length === 0 && <EmptyState title="No books yet" hint="Add the first book. The PDF can be added later." />}
      <div className="flex flex-col gap-3">
        {list.data?.items.map((b) => (
          <Card key={b.id} data-testid={`admin-book-${b.id}`} className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><p className="text-lg font-semibold">{b.title}</p><p className="text-base text-slate-600">{b.author} · {taka(b.price)}</p></div>
              <Badge tone={STATUS_TONE[b.status]}>{b.status === 'processing' ? 'Preparing preview' : b.status}</Badge>
            </div>
            <p className="text-base text-slate-600">{b.purchases} unlocked · {b.hasPdf ? 'PDF uploaded' : 'No PDF yet'}{b.previewPages.length ? ` · preview pages ${b.previewPages.join(', ')}` : ''}</p>
            {b.status === 'processing' && <p className="text-sm text-slate-500">If this stays here, check that the preview pages fit the PDF.</p>}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEditing(b)}>Edit</Button>
              {b.status !== 'archived' && <Button variant="ghost" disabled={archive.isPending} onClick={() => { if (window.confirm('Archive this book? Students who unlocked it keep access.')) archive.mutate(b.id); }}>Archive</Button>}
            </div>
          </Card>
        ))}
      </div>
      <section className="mt-6 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">Most unlocked</h2>
          <a href="/api/admin/books/purchases?format=csv" className="min-h-11 py-2 text-base font-medium text-indigo-700">Download purchases (CSV)</a>
        </div>
        {top.data?.items.length === 0 && <p className="text-base text-slate-600">No purchases yet.</p>}
        {top.data?.items.map((t) => <Card key={t.bookId} className="flex items-center justify-between"><span className="text-base">{t.title}</span><span className="text-lg font-semibold">{t.unlocks}</span></Card>)}
      </section>
      <Sheet open={!!editing} title={editing === 'new' ? 'Add a book' : 'Edit book'} onClose={() => setEditing(null)}>
        {editing && <BookForm key={editing === 'new' ? 'new' : editing.id} book={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </>
  );
}
