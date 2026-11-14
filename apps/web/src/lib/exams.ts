'use client';

import { useEffect, useRef, useState } from 'react';

/** Times are always shown in Asia/Dhaka (UTC+6, no daylight saving). */
const dhaka = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', ...o });
export const fmtDateTime = (iso: string | Date): string => dhaka({ day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
export const fmtDate = (iso: string | Date): string => dhaka({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

/** `<input type="datetime-local">` value (Dhaka wall time) <-> ISO instant. */
export const toDhakaInput = (iso: string | Date): string => new Date(new Date(iso).getTime() + 6 * 3_600_000).toISOString().slice(0, 16);
export const fromDhakaInput = (v: string): string => new Date(`${v}:00+06:00`).toISOString();

export const pad = (n: number) => String(n).padStart(2, '0');
/** 3725 s -> "1:02:05", 125 s -> "02:05". */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}
export function countdownText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  if (d > 0) return `${d}d ${Math.floor((s % 86400) / 3600)}h`;
  return clock(s);
}

/** Re-renders every second (or `ms`); used for countdowns. */
export function useTick(ms = 1000): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(i);
  }, [ms]);
  return t;
}

/**
 * Offset between the server clock and this device: `serverNow - Date.now()` taken when the server value arrived.
 * Never trust the device clock for logic; always add this offset.
 */
export function useServerOffset(serverNowIso: string | undefined): number {
  const ref = useRef(0);
  const [, force] = useState(0);
  useEffect(() => {
    if (!serverNowIso) return;
    ref.current = new Date(serverNowIso).getTime() - Date.now();
    force((n) => n + 1);
  }, [serverNowIso]);
  return ref.current;
}

export interface OfferingLite { id: string; courseId: string; course: { id: string; code: string; name: string }; section: string; teaches: boolean }
export interface Opt { id: string; text: string }
export interface ExamRow {
  id: string; offeringId: string; kind: 'exam' | 'quiz'; title: string; instructions: string | null; startAt: string; endAt: string; durationMin: number;
  totalMarks: number; passMarks: number; maxAttempts: number; shuffleQuestions: boolean; shuffleOptions: boolean; showAnswersAfterEnd: boolean;
  resultMode: 'instant' | 'manual'; status: 'draft' | 'published' | 'closed'; resultsPublishedAt: string | null; revealedAt: string | null; warnings?: string[];
}
export interface TeacherQuestion { id: string; order: number; questionId: string | null; type: 'single' | 'multiple'; text: string; options: Opt[]; correct: string[]; marks: number; chapterId: string | null; isCancelled: boolean }
export interface ExamDetail extends ExamRow { questions: TeacherQuestion[] }
export interface BankQuestion { id: string; courseId: string; chapterId: string | null; type: 'single' | 'multiple'; text: string; options: Opt[]; correct: string[]; marks: number }
export const examStatusTone = (s: string): 'green' | 'amber' | 'slate' => (s === 'published' ? 'green' : s === 'draft' ? 'amber' : 'slate');
export const pctText = (n: number | null | undefined) => (n === null || n === undefined ? '-' : `${Math.round(n * 10) / 10}%`);
