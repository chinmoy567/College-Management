'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MAX_IMAGES, TEXT_LIMITS, UPLOAD_LIMITS } from '@cms/shared';
import { api } from '@/lib/api';
import { TAGS, errorText, type Me } from '@/lib/community';
import { Button, Field, Input, Select, Sheet } from '@/components/ui';

/** Create-post sheet. "Pin this post" is on by default for the Admin and Section Mentors and can only be chosen here (PRD §5.7.2). */
export function Composer({ viewer }: { viewer: Me }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [tag, setTag] = useState('general');
  const [link, setLink] = useState('');
  const [pin, setPin] = useState(true);
  const [images, setImages] = useState<File[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [problem, setProblem] = useState('');
  const imgRef = useRef<HTMLInputElement>(null);
  const canPin = viewer.role === 'admin' || !!viewer.isMentorOf;
  const muted = !!viewer.mutedUntil && new Date(viewer.mutedUntil) > new Date();

  const pickImages = (list: FileList | null) => {
    const files = [...(list ?? [])];
    const bad = files.find((f) => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > UPLOAD_LIMITS.imageBytes);
    if (bad) return setProblem('Pictures must be JPG, PNG or WebP and at most 5 MB each.');
    if (images.length + files.length > MAX_IMAGES) return setProblem(`At most ${MAX_IMAGES} pictures.`);
    setProblem('');
    setImages([...images, ...files]);
  };
  const create = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.set('text', text.trim());
      fd.set('tag', tag);
      if (link.trim()) fd.set('linkUrl', link.trim());
      if (canPin) fd.set('pin', String(pin));
      images.forEach((f) => fd.append('images', f));
      if (pdf) fd.append('pdf', pdf);
      return api('/feed/posts', { method: 'POST', body: fd });
    },
    onSuccess: () => {
      setOpen(false);
      setText('');
      setLink('');
      setImages([]);
      setPdf(null);
      setTag('general');
      setProblem('');
      void qc.invalidateQueries({ queryKey: ['feed'] });
    },
    onError: (e) => setProblem(errorText(e)),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={muted} className="w-full" data-testid="new-post">
        {muted ? 'You are muted (you can still read)' : 'Write a post'}
      </Button>
      <Sheet open={open} title="New post" onClose={() => setOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return setProblem('Write something first.');
            create.mutate();
          }}
        >
          <Field label="What do you want to share?" hint={`${text.length}/${TEXT_LIMITS.post}`}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={TEXT_LIMITS.post} rows={5} className="w-full rounded-lg border border-slate-300 p-3 text-base" />
          </Field>
          <Field label="Tag">
            <Select value={tag} onChange={(e) => setTag(e.target.value)}>
              {TAGS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Link (optional)">
            <Input type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
          </Field>
          <div className="flex flex-col gap-2">
            <input
              ref={imgRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              onChange={(e) => {
                pickImages(e.target.files);
                e.target.value = '';
              }}
            />
            <Button variant="secondary" onClick={() => imgRef.current?.click()}>
              Add pictures ({images.length}/{MAX_IMAGES})
            </Button>
            {images.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm text-slate-700">
                {images.map((f, i) => (
                  <li key={i} className="flex items-center justify-between">
                    <span className="truncate">{f.name}</span>
                    <Button variant="ghost" onClick={() => setImages(images.filter((_, j) => j !== i))}>
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Field label="PDF (optional, up to 20 MB)">
            <input
              type="file"
              accept="application/pdf"
              className="text-base"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f && f.size > UPLOAD_LIMITS.documentBytes) return setProblem('The PDF must be at most 20 MB.');
                setPdf(f);
              }}
            />
          </Field>
          {canPin && (
            <label className="flex min-h-11 items-center gap-3 text-base font-medium">
              <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} className="size-6" />
              📌 Pin this post {viewer.role === 'admin' ? '(everyone)' : '(your section)'}
            </label>
          )}
          {problem && (
            <p role="alert" className="text-base text-red-700">
              {problem}
            </p>
          )}
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Posting…' : 'Post'}
          </Button>
        </form>
      </Sheet>
    </>
  );
}
