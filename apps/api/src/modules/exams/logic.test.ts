import { describe, expect, it } from 'vitest';
import { SETTING_DEFAULTS } from '@cms/shared';
import { chapterStrength, deadline, grade, gradeFor, overallCoursePercent, percent, rankCompetition, shuffle, studentVisibility } from './logic';

const q = (id: string, marks: number, correct: string[], isCancelled = false) => ({ id, marks, correct, isCancelled });

describe('grade', () => {
  it('[EXAM-01] single answer: right = its marks, wrong = 0', () => {
    const qs = [q('a', 2, ['o2']), q('b', 3, ['o1'])];
    const r = grade(qs, [{ examQuestionId: 'a', selectedOptionIds: ['o2'] }, { examQuestionId: 'b', selectedOptionIds: ['o3'] }]);
    expect(r.score).toBe(2);
    expect(r.items.map((i) => i.marksAwarded)).toEqual([2, 0]);
  });
  it('[EXAM-02] exact set only, unanswered 0, cancelled gives everyone the marks, never negative or partial', () => {
    const qs = [q('m', 4, ['o1', 'o3']), q('x', 1, ['o1'], true), q('u', 5, ['o2'])];
    const exact = grade(qs, [{ examQuestionId: 'm', selectedOptionIds: ['o3', 'o1'] }]);
    expect(exact.score).toBe(5); // 4 + cancelled 1 + unanswered 0
    const subset = grade(qs, [{ examQuestionId: 'm', selectedOptionIds: ['o1'] }]);
    expect(subset.score).toBe(1);
    const superset = grade(qs, [{ examQuestionId: 'm', selectedOptionIds: ['o1', 'o3', 'o2'] }]);
    expect(superset.score).toBe(1);
    const empty = grade(qs, [{ examQuestionId: 'm', selectedOptionIds: [] }, { examQuestionId: 'u', selectedOptionIds: ['o1'] }]);
    expect(empty.score).toBe(1);
    expect(grade([q('h', 0.5, ['o1'])], []).score).toBe(0);
  });
});

describe('deadline, shuffle, ranks', () => {
  it('[EXAM-04] the window end caps the deadline (window to 10:00, 45 min, start 9:50 → 10:00)', () => {
    const end = new Date('2026-01-01T10:00:00Z');
    expect(deadline(new Date('2026-01-01T09:50:00Z'), 45, end).toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(deadline(new Date('2026-01-01T09:00:00Z'), 45, end).toISOString()).toBe('2026-01-01T09:45:00.000Z');
  });
  it('shuffle is a permutation and leaves the input alone', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(src, () => 0);
    expect([...out].sort()).toEqual(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(shuffle(src).length).toBe(8);
  });
  it('[EXAM-14] competition ranking gives 1, 2, 2, 4', () => {
    const r = rankCompetition([{ key: 'a', score: 9 }, { key: 'b', score: 7 }, { key: 'c', score: 7 }, { key: 'd', score: 3 }]);
    expect([r.get('a'), r.get('b'), r.get('c'), r.get('d')]).toEqual([1, 2, 2, 4]);
    expect(rankCompetition([{ key: 'a', score: 1 }, { key: 'b', score: 1 }]).get('b')).toBe(1);
  });
});

describe('overall percent, grade, chapters', () => {
  it('[EXAM-15] overall = average % over Exams, a missed exam is 0%, quizzes excluded', () => {
    const exams = [{ id: 'e1', totalMarks: 10, kind: 'exam' as const }, { id: 'e2', totalMarks: 20, kind: 'exam' as const }, { id: 'q1', totalMarks: 5, kind: 'quiz' as const }];
    expect(overallCoursePercent(exams, new Map([['e1', 10], ['q1', 5]]))).toBe(50);
    expect(overallCoursePercent(exams, new Map([['e1', 5], ['e2', 20]]))).toBe(75);
    expect(overallCoursePercent([{ id: 'q', totalMarks: 5, kind: 'quiz' }], new Map())).toBeNull();
    expect(percent(1, 3)).toBe(33.33);
  });
  it('gradeFor uses the highest band reached', () => {
    const s = [...SETTING_DEFAULTS.grading_scale];
    expect([gradeFor(100, s), gradeFor(80, s), gradeFor(79.99, s), gradeFor(33, s), gradeFor(32.99, s), gradeFor(0, s)]).toEqual(['A+', 'A+', 'A', 'D', 'F', 'F']);
  });
  it('chapterStrength needs 3 questions, takes 3 from each end and never lists a chapter twice', () => {
    const rows = (c: string, ok: number, bad: number) => [...Array(ok).fill({ chapterId: c, correct: true }), ...Array(bad).fill({ chapterId: c, correct: false })];
    const all = [...rows('c1', 3, 0), ...rows('c2', 2, 1), ...rows('c3', 1, 2), ...rows('c4', 0, 3), ...rows('c5', 3, 1), ...rows('c6', 2, 2), ...rows('few', 1, 1), { chapterId: null, correct: true }];
    const r = chapterStrength(all);
    expect(r.strong.map((s) => s.chapterId)).toEqual(['c1', 'c5', 'c2']);
    expect(r.weak.map((s) => s.chapterId)).toEqual(['c4', 'c3', 'c6']);
    expect(chapterStrength(rows('only', 3, 0))).toEqual({ strong: [{ chapterId: 'only', pct: 100, total: 3 }], weak: [] });
  });
});

describe('studentVisibility', () => {
  const base = { resultMode: 'instant' as const, revealed: false, resultsPublished: false, showAnswersAfterEnd: true, attemptStatus: 'submitted' as const };
  it('[EXAM-08] instant: total score only before reveal, everything after; correct needs the flag', () => {
    expect(studentVisibility(base)).toMatchObject({ state: 'score_only', showScore: true, showPerQuestion: false, showRanks: false, showCorrect: false });
    expect(studentVisibility({ ...base, revealed: true, resultsPublished: true })).toMatchObject({ state: 'full', showPerQuestion: true, showRanks: true, showCorrect: true });
    expect(studentVisibility({ ...base, revealed: true, resultsPublished: true, showAnswersAfterEnd: false }).showCorrect).toBe(false);
    expect(studentVisibility({ ...base, revealed: true, resultsPublished: false }).showCorrect).toBe(false);
  });
  it('[EXAM-09] manual: nothing until the teacher publishes', () => {
    const m = { ...base, resultMode: 'manual' as const };
    expect(studentVisibility(m)).toMatchObject({ state: 'pending', showScore: false });
    expect(studentVisibility({ ...m, revealed: true })).toMatchObject({ state: 'pending', showScore: false, showCorrect: false });
    expect(studentVisibility({ ...m, resultsPublished: true })).toMatchObject({ state: 'pending' });
    expect(studentVisibility({ ...m, revealed: true, resultsPublished: true })).toMatchObject({ state: 'full', showScore: true, showCorrect: true });
  });
  it('an attempt in progress sees nothing', () => {
    expect(studentVisibility({ ...base, attemptStatus: 'in_progress', revealed: true, resultsPublished: true })).toMatchObject({ state: 'in_progress', showScore: false, showCorrect: false });
  });
});
