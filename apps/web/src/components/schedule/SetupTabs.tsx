'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg, fieldErrors } from '@/lib/queries';
import { Button, Card, EmptyState, ErrorState, Field, Input, ListSkeleton, Select, Sheet } from '@/components/ui';

export interface Period { id: string; name: string; startTime: string; endTime: string }
export interface Room { id: string; name: string; capacity: number | null; building: string | null }

type Kind = 'periods' | 'rooms';
const KEY: Record<Kind, string> = { periods: 'periods', rooms: 'rooms' };

/** Add / edit form for a period (name + start/end) or a room (name, optional capacity). */
function ItemForm({ kind, item, onDone }: { kind: Kind; item?: Period | Room; onDone: () => void }) {
  const qc = useQueryClient();
  const isPeriod = kind === 'periods';
  const [name, setName] = useState(item?.name ?? '');
  const [start, setStart] = useState((item as Period | undefined)?.startTime ?? '');
  const [end, setEnd] = useState((item as Period | undefined)?.endTime ?? '');
  const [capacity, setCapacity] = useState(String((item as Room | undefined)?.capacity ?? ''));
  const save = useMutation({
    mutationFn: () =>
      api(`/schedule/${kind}${item ? `/${item.id}` : ''}`, {
        method: item ? 'PATCH' : 'POST',
        json: isPeriod ? { name, startTime: start, endTime: end } : { name, ...(capacity ? { capacity: Number(capacity) } : {}) },
      }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [KEY[kind]] }); onDone(); },
  });
  const f = fieldErrors(save.error);
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Field label="Name" error={f.name}><Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} /></Field>
      {isPeriod ? (
        <>
          <Field label="Starts" error={f.startTime}><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} required /></Field>
          <Field label="Ends" error={f.endTime}><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required /></Field>
        </>
      ) : (
        <Field label="Capacity (optional)" error={f.capacity}><Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></Field>
      )}
      {save.isError && !Object.keys(f).length && <p role="alert" className="text-base text-red-700">{errMsg(save.error)}</p>}
      <Button type="submit" disabled={save.isPending}>{item ? 'Save changes' : isPeriod ? 'Add period' : 'Add room'}</Button>
    </form>
  );
}

/** Delete with an optional replacement, needed when the item is used by routine slots. */
function DeleteForm({ kind, item, others, onDone }: { kind: Kind; item: Period | Room; others: (Period | Room)[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [replacement, setReplacement] = useState('');
  const del = useMutation({
    mutationFn: () =>
      api(`/schedule/${kind}/${item.id}`, {
        method: 'DELETE',
        json: replacement ? (kind === 'periods' ? { replacementPeriodId: replacement } : { replacementRoomId: replacement }) : {},
      }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [KEY[kind]] }); void qc.invalidateQueries({ queryKey: ['routine'] }); onDone(); },
  });
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); del.mutate(); }}>
      <p className="text-base">Delete <strong>{item.name}</strong>? If routine classes use it, choose a replacement.</p>
      <Field label="Replacement (only if it is in use)">
        <Select value={replacement} onChange={(e) => setReplacement(e.target.value)}>
          <option value="">No replacement</option>
          {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
      </Field>
      {del.isError && <p role="alert" className="text-base text-red-700">{errMsg(del.error)}</p>}
      <Button type="submit" variant="danger" disabled={del.isPending}>Delete</Button>
    </form>
  );
}

export function SetupTab({ kind }: { kind: Kind }) {
  const label = kind === 'periods' ? 'period' : 'room';
  const q = useQuery({ queryKey: [KEY[kind]], queryFn: () => api<Record<string, (Period | Room)[]>>(`/schedule/${kind}`) });
  const items = q.data?.[kind] ?? [];
  const [sheet, setSheet] = useState<{ mode: 'add' | 'edit' | 'delete'; item?: Period | Room } | null>(null);
  return (
    <section aria-label={kind}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold capitalize">{kind}</h2>
        <Button onClick={() => setSheet({ mode: 'add' })}>Add {label}</Button>
      </div>
      {q.isPending && <ListSkeleton rows={3} />}
      {q.isError && <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && items.length === 0 && <EmptyState title={`No ${kind} yet`} hint={kind === 'periods' ? 'Add the college periods first, then build each section routine.' : 'Rooms are optional on a routine slot.'} />}
      <div className="flex flex-col gap-2">
        {items.map((it) => (
          <Card key={it.id} data-testid={`${label}-row`} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">{it.name}</p>
              {'startTime' in it && <p className="text-base text-slate-600">{it.startTime}–{it.endTime}</p>}
              {'capacity' in it && it.capacity && <p className="text-base text-slate-600">Capacity {it.capacity}</p>}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setSheet({ mode: 'edit', item: it })}>Edit</Button>
              <Button variant="secondary" onClick={() => setSheet({ mode: 'delete', item: it })}>Delete</Button>
            </div>
          </Card>
        ))}
      </div>
      <Sheet open={!!sheet} title={sheet?.mode === 'delete' ? `Delete ${label}` : sheet?.mode === 'edit' ? `Edit ${label}` : `Add ${label}`} onClose={() => setSheet(null)}>
        {sheet?.mode === 'delete' && sheet.item ? (
          <DeleteForm kind={kind} item={sheet.item} others={items.filter((o) => o.id !== sheet.item!.id)} onDone={() => setSheet(null)} />
        ) : sheet ? (
          <ItemForm kind={kind} item={sheet.item} onDone={() => setSheet(null)} />
        ) : null}
      </Sheet>
    </section>
  );
}
