'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { INTEGRITY_CAP } from '@cms/shared';
import { api, ApiError } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { type OfferingCtx, clock, offeringLabel, type Opt } from '@/lib/exams';
import { ErrorState, ListSkeleton, Sheet, cn } from '@/components/ui';

/*
 * The exam page (05 §8). Deliberately plain: no animation or transitions, a sticky timer that is always visible,
 * one question per screen, 56 px option targets, an auto-save on every tap with a "saved" tick, an offline retry
 * queue that is dropped once the server says DEADLINE_PASSED, and integrity events sent in batches every 10 s.
 */

interface Question { id: string; type: 'single' | 'multiple'; text: string; marks: number; options: Opt[] }
interface Saved { examQuestionId: string; selectedOptionIds: string[]; markedForReview: boolean }
interface Taking extends OfferingCtx { id: string; examId: string; status: string; deadlineAt: string; serverNow: string; title: string; totalMarks: number; questions: Question[]; answers: Saved[]; offset: number }
type Ans = { sel: string[]; marked: boolean };
type IntegrityType = 'blur' | 'focus' | 'fullscreen_exit' | 'visibility_hidden';
type SaveState = 'saved' | 'saving' | 'offline';

const FLUSH_MS = 10_000;
const RETRY_MS = 3_000;
const BATCH = 100;

export default function ExamPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const router = useRouter();
  const q = useQuery({
    queryKey: ['attempt', attemptId],
    queryFn: async (): Promise<Taking> => {
      const res = await api<Omit<Taking, 'offset'>>(`/exams/attempts/${attemptId}`);
      return { ...res, offset: new Date(res.serverNow).getTime() - Date.now() };
    },
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 2,
  });
  useEffect(() => {
    // Already finished (or its time ran out while the tab was closed): go to the result screen.
    if (q.data && q.data.status !== 'in_progress') router.replace(`/student/exams/${q.data.examId}`);
  }, [q.data, router]);

  if (q.isPending || (q.data && q.data.status !== 'in_progress'))
    return <div className="p-4"><ListSkeleton rows={3} /></div>;
  if (q.isError) return <div className="p-4"><ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} /></div>;
  return <Taker data={q.data} />;
}

function Taker({ data }: { data: Taking }) {
  const router = useRouter();
  const deadline = useMemo(() => new Date(data.deadlineAt).getTime(), [data.deadlineAt]);
  const [answers, setAnswers] = useState<Record<string, Ans>>(() => Object.fromEntries(data.answers.map((a) => [a.examQuestionId, { sel: a.selectedOptionIds, marked: a.markedForReview }])));
  const [idx, setIdx] = useState(0);
  const [nav, setNav] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now() + data.offset);
  const [phase, setPhase] = useState<'taking' | 'submitting' | 'failed'>('taking');

  const queue = useRef(new Map<string, { selectedOptionIds: string[]; markedForReview: boolean }>());
  const inflight = useRef(false);
  const finished = useRef(false);
  const submitting = useRef(false);
  const events = useRef<{ type: IntegrityType; at: string }[]>([]);

  // ───── integrity events ─────
  const flushEvents = useCallback(async () => {
    while (events.current.length > 0) {
      const batch = events.current.splice(0, BATCH);
      try {
        await api(`/exams/attempts/${data.id}/integrity`, { method: 'POST', json: { events: batch } });
      } catch (e) {
        if (!(e instanceof ApiError) || e.status >= 500) events.current = [...batch, ...events.current].slice(-INTEGRITY_CAP); // keep for the next round
        return;
      }
    }
  }, [data.id]);
  useEffect(() => {
    const push = (type: IntegrityType) => {
      if (!finished.current) events.current.push({ type, at: new Date().toISOString() });
    };
    const onVis = () => push(document.visibilityState === 'hidden' ? 'visibility_hidden' : 'focus');
    const onBlur = () => push('blur');
    const onFocus = () => push('focus');
    const onFs = () => { if (!document.fullscreenElement) push('fullscreen_exit'); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('fullscreenchange', onFs);
    const timer = setInterval(() => void flushEvents(), FLUSH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('fullscreenchange', onFs);
      clearInterval(timer);
    };
  }, [flushEvents]);

  // ───── finish (submit, then the result screen) ─────
  const finish = useCallback(async () => {
    if (submitting.current) return;
    submitting.current = true;
    finished.current = true;
    setPhase('submitting');
    setNav(false);
    queue.current.clear(); // after the deadline the server rejects saves anyway
    try {
      await flushEvents();
      await api(`/exams/attempts/${data.id}/submit`, { method: 'POST' });
      router.replace(`/student/exams/${data.examId}`);
    } catch {
      submitting.current = false;
      setPhase('failed');
    }
  }, [data.id, data.examId, flushEvents, router]);

  // ───── saving: one PUT per tap, queued and retried while offline ─────
  const drain = useCallback(async () => {
    if (inflight.current || finished.current) return;
    inflight.current = true;
    try {
      while (queue.current.size > 0 && !finished.current) {
        const [qid, payload] = queue.current.entries().next().value as [string, { selectedOptionIds: string[]; markedForReview: boolean }];
        try {
          await api(`/exams/attempts/${data.id}/answers/${qid}`, { method: 'PUT', json: payload });
          if (queue.current.get(qid) === payload) queue.current.delete(qid);
          setLastSaved(qid);
        } catch (e) {
          if (e instanceof ApiError && e.code === 'DEADLINE_PASSED') {
            queue.current.clear(); // too late: drop everything and finish
            inflight.current = false;
            void finish();
            return;
          }
          if (e instanceof ApiError && e.status >= 400 && e.status < 500) { queue.current.delete(qid); continue; } // rejected for good
          setSaveState('offline'); // network or server trouble: keep it queued
          return;
        }
      }
      setSaveState('saved');
    } finally {
      inflight.current = false;
    }
  }, [data.id, finish]);

  useEffect(() => {
    const retry = setInterval(() => { if (queue.current.size > 0) void drain(); }, RETRY_MS);
    const online = () => void drain();
    window.addEventListener('online', online);
    return () => { clearInterval(retry); window.removeEventListener('online', online); };
  }, [drain]);

  const save = (qid: string, next: Ans) => {
    setAnswers((a) => ({ ...a, [qid]: next }));
    queue.current.set(qid, { selectedOptionIds: next.sel, markedForReview: next.marked });
    setSaveState('saving');
    void drain();
  };

  // ───── timer (server-corrected) ─────
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + data.offset), 1000);
    return () => clearInterval(t);
  }, [data.offset]);
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  useEffect(() => {
    if (remaining <= 0 && phase === 'taking') void finish();
  }, [remaining, phase, finish]);

  const qs = data.questions;
  const cur = qs[idx];
  const ansOf = (id: string): Ans => answers[id] ?? { sel: [], marked: false };
  const answeredCount = qs.filter((x) => ansOf(x.id).sel.length > 0).length;
  const choose = (opt: string) => {
    if (!cur) return;
    const a = ansOf(cur.id);
    const sel = cur.type === 'single' ? (a.sel[0] === opt ? [] : [opt]) : a.sel.includes(opt) ? a.sel.filter((s) => s !== opt) : [...a.sel, opt];
    save(cur.id, { ...a, sel });
  };

  if (phase !== 'taking')
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-xl font-semibold" role="status">{phase === 'submitting' ? 'Submitting your exam…' : 'Could not submit yet'}</p>
        {phase === 'failed' && (
          <>
            <p className="text-base text-slate-600">Check your connection. Your saved answers are safe.</p>
            <button type="button" onClick={() => void finish()} className="min-h-12 rounded-lg bg-indigo-600 px-6 text-base font-medium text-white transition-none">Try again</button>
          </>
        )}
      </div>
    );

  const low = remaining <= 60;
  const statusText = saveState === 'saved' ? 'Saved ✓' : saveState === 'saving' ? 'Saving…' : 'Offline, will retry';
  return (
    <div className="flex min-h-screen flex-col bg-white" data-testid="exam-page">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold" data-testid="exam-title">{data.title}</p>
          <p className="truncate text-sm text-slate-600" data-testid="offering-label">{offeringLabel(data)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span data-testid="save-status" data-state={saveState} data-saved-question={lastSaved ?? ''} aria-live="polite" className={cn('text-sm', saveState === 'offline' ? 'font-medium text-red-700' : 'text-slate-600')}>
            {statusText}
          </span>
          <span data-testid="timer" role="timer" aria-label="Time left" className={cn('rounded-md px-2 py-1 font-mono text-xl font-bold tabular-nums', low ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-900')}>
            {clock(remaining)}
          </span>
        </div>
      </header>

      {cur ? (
        <main className="flex-1 px-4 pb-4 pt-3" data-testid="question-screen">
          <div className="mb-2 flex items-center justify-between text-base text-slate-600">
            <span data-testid="question-counter">Question {idx + 1} of {qs.length}</span>
            <span>{cur.marks} {cur.marks === 1 ? 'mark' : 'marks'}</span>
          </div>
          <h1 className="whitespace-pre-wrap text-lg font-medium text-slate-900" data-testid="question-text">{cur.text}</h1>
          <p className="mb-3 mt-1 text-sm text-slate-600">{cur.type === 'single' ? 'Choose one answer' : 'Choose all that apply'}</p>
          <div role={cur.type === 'single' ? 'radiogroup' : 'group'} aria-label="Options" className="flex flex-col gap-3">
            {cur.options.map((o) => {
              const on = ansOf(cur.id).sel.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  role={cur.type === 'single' ? 'radio' : 'checkbox'}
                  aria-checked={on}
                  data-testid={`option-${o.id}`}
                  onClick={() => choose(o.id)}
                  className={cn('flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-base transition-none', on ? 'border-indigo-600 bg-indigo-50 font-medium' : 'border-slate-300 bg-white')}
                >
                  <span aria-hidden className={cn('flex size-6 shrink-0 items-center justify-center border-2 text-sm', cur.type === 'single' ? 'rounded-full' : 'rounded-md', on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-400')}>
                    {on ? '✓' : ''}
                  </span>
                  <span className="min-w-0 break-words">{o.text}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-pressed={ansOf(cur.id).marked}
            data-testid="mark-review"
            onClick={() => save(cur.id, { ...ansOf(cur.id), marked: !ansOf(cur.id).marked })}
            className={cn('mt-4 min-h-11 rounded-lg border px-4 text-base transition-none', ansOf(cur.id).marked ? 'border-amber-500 bg-amber-100 font-medium text-amber-900' : 'border-slate-300 text-slate-800')}
          >
            {ansOf(cur.id).marked ? 'Marked for review' : 'Mark for review'}
          </button>
        </main>
      ) : (
        <main className="flex-1 p-4 text-base">This exam has no questions.</main>
      )}

      <footer className="sticky bottom-0 z-20 grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-slate-200 bg-white px-3 py-2">
        <button type="button" data-testid="prev-q" disabled={idx === 0} onClick={() => setIdx(idx - 1)} className="min-h-12 rounded-lg bg-slate-100 px-4 text-base font-medium transition-none disabled:opacity-40">Previous</button>
        <button type="button" data-testid="open-navigator" onClick={() => setNav(true)} className="min-h-12 rounded-lg border border-indigo-600 px-4 text-base font-medium text-indigo-700 transition-none">
          {answeredCount}/{qs.length}
        </button>
        <button type="button" data-testid="next-q" disabled={idx >= qs.length - 1} onClick={() => setIdx(idx + 1)} className="min-h-12 rounded-lg bg-indigo-600 px-4 text-base font-medium text-white transition-none disabled:opacity-40">Next</button>
      </footer>

      <Sheet open={nav} title="Questions" onClose={() => { setNav(false); setConfirm(false); }}>
        <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700" aria-label="Legend">
          <li><span className="mr-1 inline-block size-3 rounded-sm bg-indigo-600 align-middle" />Answered</li>
          <li><span className="mr-1 inline-block size-3 rounded-sm bg-amber-400 align-middle" />Marked</li>
          <li><span className="mr-1 inline-block size-3 rounded-sm border border-slate-400 align-middle" />Empty</li>
        </ul>
        <div className="grid grid-cols-5 gap-2" data-testid="navigator">
          {qs.map((x, i) => {
            const a = ansOf(x.id);
            const state = a.marked ? 'marked' : a.sel.length > 0 ? 'answered' : 'empty';
            return (
              <button
                key={x.id}
                type="button"
                data-state={state}
                aria-label={`Question ${i + 1}, ${state}`}
                onClick={() => { setIdx(i); setNav(false); setConfirm(false); }}
                className={cn(
                  'min-h-12 rounded-lg text-base font-medium transition-none',
                  state === 'marked' ? 'bg-amber-400 text-slate-900' : state === 'answered' ? 'bg-indigo-600 text-white' : 'border border-slate-400 bg-white text-slate-800',
                  i === idx && 'ring-2 ring-slate-900 ring-offset-2',
                )}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        <div className="mt-6 border-t border-slate-200 pt-4">
          {!confirm ? (
            <button type="button" data-testid="submit-exam" onClick={() => setConfirm(true)} className="min-h-12 w-full rounded-lg bg-red-600 text-base font-medium text-white transition-none">Submit exam</button>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-base" role="alert">
                {qs.length - answeredCount > 0 ? `${qs.length - answeredCount} question(s) are not answered. ` : ''}Submit now? You cannot change answers after.
              </p>
              <button type="button" data-testid="confirm-submit" onClick={() => void finish()} className="min-h-12 w-full rounded-lg bg-red-600 text-base font-medium text-white transition-none">Yes, submit</button>
              <button type="button" onClick={() => setConfirm(false)} className="min-h-12 w-full rounded-lg bg-slate-100 text-base font-medium transition-none">Keep working</button>
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}
