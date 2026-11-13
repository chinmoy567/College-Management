# Plan 05 · Exams, Quizzes & Progress (Milestone M7)

Spec: `docs/spec/05-exams-progress.md` · PRD §5.14, §5.15, §5.20. Agent: `exam-attendance-builder`. Skill: `cms-exams-attendance`.
Client rule: **right = marks, wrong/unanswered = 0, no negative, no partial.**
Depends on M3 (offerings, enrollments) and M6 (files/notify fan-out patterns; chapters).

## 1. Core design

- **The server is the only clock and the only grader.** Correctness never depends on a job: every answer/submit checks `deadlineAt`; every read of an expired in-progress attempt finalises it lazily (`finaliseIfExpired(attempt)`). Jobs only make it timely.
- **Snapshot on publish:** `ExamQuestion` copies text/options/correct/marks/chapter, so bank edits never reach a published exam (EXAM-13).
- **One serializer per audience and moment** (`examView.forStudent(attempt, exam, now)`), and `correct` is added only when `revealed && resultsPublished && showAnswersAfterEnd`. A JSON snapshot test over every student endpoint proves no leak (EXAM-06).

## 2. Build order

1. **Pure logic first** (unit-tested, no DB): `grade(questions, answers)` (exact-set match, cancelled → full marks, Decimal sum), `deadline(now, durationMin, endAt)`, `shuffle(seed)` (Fisher–Yates with `crypto`), `rankCompetition(scores)` (1,2,2,4), `overallCoursePercent(exams, attempts)` (missed = 0%, quizzes excluded), `gradeFor(pct, scale)`, `chapterStrength()`, `studentVisibility(exam, attempt, now)` → the table in §4.3.
2. **Question bank** (§2): CRUD with stable option ids `o1..o6`, `single`=1 correct, `multiple`≥1, marks 0.5 steps ≤ 100; archive on delete; CSV import (dry run, all-or-nothing). Only the teacher's own questions for courses they teach.
3. **Exam lifecycle** (§3): create (`durationMin` enum, EXAM-18), set questions, publish (snapshot, `totalMarks`, `passMarks ≤ totalMarks`, jobs `exam.starting_soon` + `exam.close_check`, notify `exam_published`), edit before start (re-snapshot) / `EXAM_LOCKED` after, delete rules, maintenance-window warning.
   Permission: **only the teacher of the offering**; Admin gets 403 on create; another teacher gets 404 (EXAM-16).
4. **Start attempt** (§4.1): transaction with `SELECT … FROM exams WHERE id=$1 FOR UPDATE`, enrollment + window checks, resume existing in-progress (unique partial index is the backstop), attempt count / quiz previous-submitted, `deadlineAt`, `sectionId` = current section, `questionOrder` + per-question option order stored on the attempt, schedule `exam.auto_submit` (singletonKey = attemptId). Response: questions without `correct`, `deadlineAt`, `serverNow`.
5. **Answer save hot path** (§4.2): single `UPDATE exam_attempts … WHERE id AND status='in_progress' AND deadline_at > now()` guard + one `INSERT … ON CONFLICT (attempt_id, exam_question_id) DO UPDATE` — ideally both in one raw SQL CTE so it's one round-trip (p95 < 300 ms at 500 users, OPS-05). Validate option ids against the snapshot cached in memory per exam (LRU, invalidated on fix-key).
6. **Integrity events** (append, cap 500), **submit** (5 s grace for the request, but answers after deadline rejected; idempotent), **auto-submit job** (re-schedules itself if deadline moved).
7. **Reveal/close** (`exam.close_check` at `endAt`, every 5 min while attempts in progress): sets `revealedAt`, `closed`, instant-mode `resultsPublishedAt`, notifies. Lazy computation on read too.
8. **Manual publish results**, **fix key / cancel question** (`ExamChangeLog`, `exam.regrade` job regrades every submitted attempt in batches, notify `exam_key_fixed`; snapshot cache invalidated), **extra time / reopen** (`AttemptExtension`, re-schedule auto-submit, delays reveal for the exam).
9. **Ranks & progress** (§7): SQL with `RANK() OVER (PARTITION BY section_id ORDER BY score DESC)`; quiz best attempt via `DISTINCT ON`; overall course rank over published Exams with missed = 0 (LEFT JOIN enrolled students × exams). Grade from Settings scale. Chapters top/bottom 3 with ≥ 3 questions.
10. **Reports**: exam report (10-bucket distribution, highest/avg/lowest, per-question %, did-not-attend, integrity counts), CSV/PDF; offering progress; Admin performance; student progress + PDF.
11. **Wire back** into earlier specs: pass-out auto-submits running attempts (03 §6), move blocked with `ATTEMPT_IN_PROGRESS` (03 §5.4), `hasLiveAttempt(studentId)` for AI block (09, M10).
12. **Screens**: teacher exam builder (bank picker + inline question), exam report; student exam list with countdowns, **exam page** (sticky timer from `deadlineAt − serverOffset`, navigator, one question per screen, tap-to-save tick, offline retry queue dropped on `DEADLINE_PASSED`, integrity listeners batched every 10 s, no animation, no nav bar), progress page with lazy Recharts.

## 3. Senior notes

- **Timer drift:** compute `offset = serverNow − Date.now()` at start/resume; never trust the client clock for logic.
- **Deadline equality:** `now < deadlineAt` strictly for answers (EXAM-03 tests ±1 s with a frozen DB clock via `SET LOCAL` time function — we use a `now()` injectable in services, so tests pass a fake clock).
- **Regrade at scale:** batch 200 attempts per transaction; idempotent (recomputes from answers).
- **Shuffle reproducibility:** order is stored, not re-derived, so reload resumes identically (EXAM-19).
- Never expose `ExamQuestion.correct` through Prisma `include` by accident: student queries use an explicit `select` constant without `correct`.

## 4. Acceptance → tests

| ID | Test |
|---|---|
| EXAM-01/02 | `[EXAM-01] single right/wrong` · `[EXAM-02] exact set, unanswered 0, cancelled full marks, never negative/partial` (unit + integration) |
| EXAM-03 | `[EXAM-03] answer 1 s before deadline ok, 1 s after 409` |
| EXAM-04 | `[EXAM-04] window end caps deadline (9:50 + 45 → 10:00)` |
| EXAM-05 | `[EXAM-05] concurrent starts one attempt; quiz next after submit; attempt limit` |
| EXAM-06 | `[EXAM-06] no correct in any student payload before reveal+published+showAnswers` (snapshot over all endpoints & moments) |
| EXAM-07 | `[EXAM-07] no questions before own attempt` |
| EXAM-08/09 | `[EXAM-08] instant mode visibility` · `[EXAM-09] manual mode nothing until publish` |
| EXAM-10 | `[EXAM-10] extra time past endAt delays reveal; reopen keeps answers; logged` |
| EXAM-11 | `[EXAM-11] fix-key/cancel regrades, logs, notifies` |
| EXAM-12/13 | `[EXAM-12] started exam locked; pre-start edit re-snapshots` · `[EXAM-13] bank edit never changes published exam` |
| EXAM-14/15 | `[EXAM-14] competition ranking within section` · `[EXAM-15] overall rank avg %, missed 0, quizzes excluded, quiz best attempt` |
| EXAM-16 | `[EXAM-16] admin create 403; other teacher 404` |
| EXAM-17 | `[EXAM-17] auto-submit by job with browser closed; lazily if job late` |
| EXAM-18 | `[EXAM-18] duration only presets` |
| EXAM-19 | Playwright `[EXAM-19] exam page 360 px timer, save tick, reload resume, no animation` |
| EXAM-20 | Playwright `[EXAM-20] progress page marks/%/grade/rank/trend/chapters` |

Also re-run `[ACAD-04]` / `[ACAD-10]` attempt clauses now that attempts exist.

## 5. Definition of done (M7)

"Scoring, deadline, regrade, rank tests pass"; all EXAM IDs green; a quick 100-user autocannon smoke on answer save (full 500-user test in M12); `cms-security-review` on exam payloads; `/spec-check 05` complete.
