import { randomInt } from 'node:crypto';
import type { GradeBand } from '@cms/shared';

/** Pure exam rules (05 §4.3, §5, §7). No database, no clock. Scores are plain numbers: marks go in 0.5 steps, so sums are exact. */

export interface GradeQuestion {
  id: string;
  marks: number;
  correct: string[];
  isCancelled: boolean;
}
export interface GradeAnswer {
  examQuestionId: string;
  selectedOptionIds: string[];
}
export interface GradedItem {
  examQuestionId: string;
  isCorrect: boolean;
  marksAwarded: number;
}

const sameSet = (a: string[], b: string[]): boolean => a.length > 0 && new Set(a).size === new Set(b).size && a.every((x) => b.includes(x));

/** Right = the question's marks, wrong or unanswered = 0. Cancelled = full marks for everyone. Never negative, never partial. */
export function grade(questions: GradeQuestion[], answers: GradeAnswer[]): { score: number; items: GradedItem[] } {
  const byQ = new Map(answers.map((a) => [a.examQuestionId, a]));
  const items = questions.map((q): GradedItem => {
    if (q.isCancelled) return { examQuestionId: q.id, isCorrect: true, marksAwarded: q.marks };
    const a = byQ.get(q.id);
    const ok = !!a && sameSet(a.selectedOptionIds, q.correct);
    return { examQuestionId: q.id, isCorrect: ok, marksAwarded: ok ? q.marks : 0 };
  });
  return { score: items.reduce((s, i) => s + i.marksAwarded, 0), items };
}

/** The earlier of start + duration and the window end (PRD §5.14.1). */
export const deadline = (now: Date, durationMin: number, endAt: Date): Date =>
  new Date(Math.min(now.getTime() + durationMin * 60_000, endAt.getTime()));

/** Fisher–Yates with a cryptographic source; returns a new array. `rnd(n)` gives an integer in [0, n). */
export function shuffle<T>(items: readonly T[], rnd: (n: number) => number = (n) => randomInt(n)): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Competition ranking (1, 2, 2, 4): equal scores share a rank, the next rank skips. */
export function rankCompetition<K>(rows: { key: K; score: number }[]): Map<K, number> {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const out = new Map<K, number>();
  let rank = 0;
  let prev: number | null = null;
  sorted.forEach((r, i) => {
    if (prev === null || r.score !== prev) rank = i + 1;
    prev = r.score;
    out.set(r.key, rank);
  });
  return out;
}

/** Percentage of an exam's marks, rounded to 2 places. */
export const percent = (score: number, total: number): number => (total > 0 ? Math.round((score / total) * 10_000) / 100 : 0);

/**
 * Overall course percentage = average % over the given Exams (not quizzes); a missed exam counts as 0 (05 §7).
 * `scores` maps examId to the student's best score; `null` when there is no exam to measure on.
 */
export function overallCoursePercent(exams: { id: string; totalMarks: number; kind?: 'exam' | 'quiz' }[], scores: ReadonlyMap<string, number>): number | null {
  const real = exams.filter((e) => (e.kind ?? 'exam') === 'exam');
  if (real.length === 0) return null;
  const sum = real.reduce((s, e) => s + percent(scores.get(e.id) ?? 0, e.totalMarks), 0);
  return Math.round((sum / real.length) * 100) / 100;
}

/** Grade letter from the Settings scale; the highest band whose `min` is not above the percentage. */
export function gradeFor(pct: number, scale: GradeBand[]): string {
  const bands = [...scale].sort((a, b) => b.min - a.min);
  return (bands.find((b) => pct >= b.min) ?? bands[bands.length - 1])?.g ?? '-';
}

export interface ChapterStat {
  chapterId: string;
  pct: number;
  total: number;
}
/**
 * Strong and weak chapters from per-question correctness. Needs at least `minQuestions` per chapter. Takes up to
 * 3 from each end; with few chapters the list is split so a chapter is never both strong and weak.
 */
export function chapterStrength(rows: { chapterId: string | null; correct: boolean }[], minQuestions = 3, take = 3): { strong: ChapterStat[]; weak: ChapterStat[] } {
  const acc = new Map<string, { ok: number; total: number }>();
  for (const r of rows) {
    if (!r.chapterId) continue;
    const e = acc.get(r.chapterId) ?? { ok: 0, total: 0 };
    e.total += 1;
    if (r.correct) e.ok += 1;
    acc.set(r.chapterId, e);
  }
  const stats = [...acc.entries()]
    .filter(([, e]) => e.total >= minQuestions)
    .map(([chapterId, e]): ChapterStat => ({ chapterId, pct: Math.round((e.ok / e.total) * 10_000) / 100, total: e.total }))
    .sort((a, b) => b.pct - a.pct || a.chapterId.localeCompare(b.chapterId));
  const nStrong = Math.min(take, Math.ceil(stats.length / 2));
  const nWeak = Math.min(take, Math.floor(stats.length / 2));
  return { strong: stats.slice(0, nStrong), weak: stats.slice(stats.length - nWeak).reverse() };
}

export interface VisibilityInput {
  resultMode: 'instant' | 'manual';
  /** `revealedAt` is set: window over and no attempt of the exam in progress. */
  revealed: boolean;
  resultsPublished: boolean;
  showAnswersAfterEnd: boolean;
  attemptStatus: 'in_progress' | 'submitted' | 'auto_submitted';
}
export interface Visibility {
  state: 'in_progress' | 'pending' | 'score_only' | 'full';
  showScore: boolean;
  showPerQuestion: boolean;
  showRanks: boolean;
  /** The one gate for `correct` in any student payload (05 §4.3). */
  showCorrect: boolean;
}

/** What a student may see of a finished attempt (the table in 05 §4.3). */
export function studentVisibility(v: VisibilityInput): Visibility {
  const none = { showScore: false, showPerQuestion: false, showRanks: false, showCorrect: false };
  if (v.attemptStatus === 'in_progress') return { state: 'in_progress', ...none };
  if (v.resultMode === 'instant') {
    if (!v.revealed) return { state: 'score_only', ...none, showScore: true };
    return { state: 'full', showScore: true, showPerQuestion: true, showRanks: true, showCorrect: v.resultsPublished && v.showAnswersAfterEnd };
  }
  if (!v.revealed || !v.resultsPublished) return { state: 'pending', ...none };
  return { state: 'full', showScore: true, showPerQuestion: true, showRanks: true, showCorrect: v.showAnswersAfterEnd };
}
