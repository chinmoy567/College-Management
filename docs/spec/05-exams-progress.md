# 05 · Exams, Quizzes & Progress

Source: PRD §5.14, §5.15, §5.20 (AI off during exam). Skill: `cms-exams-attendance`.
**Scoring (client decision): right = the question's marks, wrong or unanswered = 0. No negative, no partial marks.**

## 1. Who

- Create/edit/manage: the **course teacher of the offering** only (a mentor only for offerings they teach). The Admin cannot create exams (PRD §2.1) but can view all results.
- Results/progress view: teacher (own offerings), mentor (own section), Admin (all), student (own only).

## 2. Question bank

| Route | Notes |
|---|---|
| `GET /api/exams/bank?courseId&chapterId&q&cursor` | Teacher's own questions for a course they teach. |
| `POST /api/exams/bank` | `{ courseId, chapterId?, type: single|multiple, text, options: [{text}] (2–6), correct: [index...], marks (default 1, 0.5 steps, max 100) }` → server assigns stable option ids `o1..o6`. `single` needs exactly 1 correct; `multiple` needs ≥ 1. |
| `PATCH/DELETE /api/exams/bank/:id` | Edits never change published exams (snapshot). Delete = archive. |
| `POST /api/exams/bank/import` | CSV `text,option1..option6,correct(1;3),marks,chapter` with dry run, all-or-nothing. |

Text-based MCQ only: no images, no written answers, no student uploads (PRD §5.14.1).

## 3. Exam lifecycle

`draft → published → closed` (closed = `endAt` passed and every attempt finished).

| Route | Rules |
|---|---|
| `POST /api/exams` | `{ offeringId, kind, title, instructions?, startAt, endAt, durationMin ∈ {15,30,45,60,90,120}, passMarks, maxAttempts (exam: 1; quiz: 1–10 or 0 = unlimited), shuffleQuestions, shuffleOptions, showAnswersAfterEnd, resultMode: instant|manual }`. `startAt > now`, `endAt > startAt`. |
| `PUT /api/exams/:id/questions` | `{ items: [{ questionId } | { inline question }], order }`. Draft or published-before-start only. |
| `POST /api/exams/:id/publish` | Needs ≥ 1 question and `startAt > now`. Copies questions into `ExamQuestion` (snapshot), sets `totalMarks = Σ marks`, `passMarks <= totalMarks`, status `published`; schedules jobs (`exam.starting_soon` at start − 15 min, `exam.close_check` at `endAt`). Notifies enrolled students (`exam_published`). |
| `PATCH /api/exams/:id` | Before `startAt`: any field; a change to questions re-copies the snapshot. After `startAt`: `409 EXAM_LOCKED` except §6. |
| `DELETE /api/exams/:id` | Draft, or published with no attempts and before start. |

Reminder: no exams during the maintenance window (PRD §8) — the form warns if the window overlaps `Settings.maintenance_window` (optional setting).

## 4. Taking an exam

### 4.1 Start — `POST /api/exams/:id/attempts`
One transaction with `SELECT ... FOR UPDATE` on the exam row for this student:
1. Student has an active enrollment in the offering; exam `published`; `startAt <= now < endAt` (`409 EXAM_NOT_OPEN`).
2. No `in_progress` attempt (unique partial index) — if one exists, return it (resume).
3. Attempts used < `maxAttempts` (unless 0) else `409 NO_ATTEMPTS_LEFT`. Quiz: previous attempt must be submitted.
4. `deadlineAt = min(now + durationMin, endAt)`; `sectionId` = student's current section; `questionOrder` = shuffled (Fisher–Yates, server) per settings; insert attempt.
5. Schedule job `exam.auto_submit` `{ attemptId }` at `deadlineAt` (singleton key = attemptId).
6. Return questions **without `correct`**, in `questionOrder`, plus `deadlineAt` and `serverNow`.

Questions are never returned before the student's own attempt starts (PRD §5.14.1).

### 4.2 During
| Route | Rules |
|---|---|
| `GET /api/exams/attempts/:id` | Resume: same order, saved answers, `deadlineAt`, `serverNow`. Own attempt only. |
| `PUT /api/exams/attempts/:id/answers/:examQuestionId` `{ selectedOptionIds[], markedForReview }` | `status = in_progress` **and `now < deadlineAt`** else `409 DEADLINE_PASSED`. Option ids must belong to the question; `single` → max 1. Upsert. Cheap: one indexed write; this is the hot path for 500 concurrent students. |
| `POST /api/exams/attempts/:id/integrity` `{ events: [{ type: blur|focus|fullscreen_exit|visibility_hidden, at }] }` | Appended to `integrityLog` (capped 500 entries). |
| `POST /api/exams/attempts/:id/submit` | Allowed while `in_progress` (grace 5 s after deadline for network latency; answers after the deadline are still rejected). Grades (§5), `status=submitted`, `submittedAt`. Idempotent: second submit returns the same result. |

- Job `exam.auto_submit`: if still `in_progress` and `now >= deadlineAt` → grade, `status=auto_submitted`. If the deadline moved (extra time) the job re-schedules itself. Correctness never depends on the job (every answer/submit checks `deadlineAt`; every read of an expired in-progress attempt finalises it lazily).
- The clock keeps running while offline (PRD §5.14.2).
- AI chat is blocked for a student who has an `in_progress` attempt with `now < deadlineAt` (09 §2.4).

### 4.3 What the student sees and when
Let `revealed = now >= endAt AND no attempt of this exam is in_progress` (stored as `revealedAt` by the close-check job, also computed lazily).

| Moment | `resultMode = instant` | `resultMode = manual` |
|---|---|---|
| After own submit, before reveal | total score only | "Submitted, result pending" |
| After reveal, results not published | per-question right/wrong + ranks; correct answers if `showAnswersAfterEnd` | "Result pending" |
| After teacher publishes (`resultsPublishedAt`) | same as above | score, per-question, ranks, correct answers (if enabled) |

- Instant mode sets `resultsPublishedAt = revealedAt` automatically.
- The API never sends `correct` before reveal **and** results published **and** `showAnswersAfterEnd`. Grading happens only on the server.
- Teacher: `POST /api/exams/:id/publish-results` (manual mode; allowed after reveal) → notify students `result_published`.

## 5. Grading

```
for each ExamQuestion q of the exam:
  if q.isCancelled            → awarded = q.marks              (everyone gets the marks)
  else a = answer(attempt, q)
       correct = a exists and set(a.selectedOptionIds) == set(q.correct)
       awarded = correct ? q.marks : 0
score = Σ awarded         (Decimal; no negative, no partial)
```

Write `Answer.isCorrect/marksAwarded` for every question (create empty answers for unanswered ones) and `attempt.score` in one transaction.

## 6. After start: answer-key fix, cancel, extra time

| Route | Rules |
|---|---|
| `POST /api/exams/:id/questions/:qid/fix-key` `{ correct: [optionId] }` | Teacher of the offering. Updates `ExamQuestion.correct`, writes `ExamChangeLog`, regrades every submitted attempt in one job (`exam.regrade`), notifies students (`exam_key_fixed`). In-progress attempts are graded with the new key at submit. |
| `POST /api/exams/:id/questions/:qid/cancel` | `isCancelled = true`, same logging/regrade/notify. |
| `POST /api/exams/attempts/:id/extend` `{ minutes (1–120), reopen?: boolean }` | Teacher. In progress: `deadlineAt += minutes` (may pass `endAt`). Auto-submitted (or submitted) + `reopen`: `status=in_progress`, `deadlineAt = now + minutes`, saved answers kept, score cleared until re-submit. Only the latest attempt. Logs `AttemptExtension` (who, minutes). Re-schedules auto-submit. Delays `revealedAt` for the whole exam (reveal waits for this attempt). |

Nothing else in a started exam can be edited.

## 7. Ranks & progress (PRD §5.15)

- **Rank scope = section of the attempt** (`ExamAttempt.sectionId`). Never group- or college-wide.
- **Per exam:** students ranked by score (exam: the single attempt; quiz: best attempt) using competition ranking (`RANK()` → 1, 2, 2, 4). Only available after reveal and results published.
- **Overall rank per course offering:** for each student enrolled (active) in the offering, `avg(percentage)` over all **Exams** (`kind=exam`) of the offering with results published; a missed exam = 0%. Quizzes excluded. `RANK()` over that average within the section.
- **Grade:** percentage → `Settings.grading_scale`.
- **Strong/weak chapters:** per student, correctness % grouped by `ExamQuestion.chapterId` across published exams/quizzes; top 3 / bottom 3 with ≥ 3 questions.

| Route | Who | Returns |
|---|---|---|
| `GET /api/exams/me?status=upcoming|live|completed` | student | exams of own offerings with countdown data |
| `GET /api/exams/me/progress?courseId` | student | results list (marks, %, grade, rank), trend series, section average series, chapters |
| `GET /api/exams/me/progress.pdf` | student | result summary PDF |
| `GET /api/exams/:id/report` | teacher, mentor, Admin | distribution (10 buckets), highest/avg/lowest, per-question correctness %, did-not-attend list, attempts with integrity counts |
| `GET /api/exams/:id/report.csv` / `.pdf` | same | export |
| `GET /api/exams/offerings/:id/progress` | teacher, mentor, Admin | per-student overall %, rank, below-pass list |
| `GET /api/admin/exams/performance?by=session|group|section|course` | Admin | college-wide averages, participation |

## 8. Exam page contract (frontend)

- Timer from `deadlineAt − (serverNow offset)`, always visible (sticky), no animation.
- Question navigator (answered / marked / empty), one question per screen on phones, big option targets, auto-save on every tap with a "saved" tick; retries queued while offline and dropped once `DEADLINE_PASSED`.
- Visibility/blur/fullscreen-exit listeners → integrity endpoint (batched every 10 s).

## 9. Acceptance

- **EXAM-01** Single-answer question: right = its marks, wrong = 0.
- **EXAM-02** Multiple-answer question is right only for the exact set; unanswered = 0; a cancelled question gives everyone its marks; a score is never negative or partial.
- **EXAM-03** An answer 1 s before the deadline is accepted; 1 s after is rejected.
- **EXAM-04** The window end caps the deadline (window to 10:00, 45 min, start 9:50 → deadline 10:00).
- **EXAM-05** Concurrent starts give one in-progress attempt; a quiz's next attempt starts only after submit; the attempt limit holds.
- **EXAM-06** No payload contains correct answers before reveal + results published + `showAnswersAfterEnd` (JSON snapshot test).
- **EXAM-07** Questions are never sent before the student's own attempt starts.
- **EXAM-08** Instant mode: only the total score before reveal; per-question results and ranks after reveal.
- **EXAM-09** Manual mode: nothing until the teacher publishes results.
- **EXAM-10** Extra time can pass `endAt` and delays reveal for the whole exam; reopening keeps saved answers; every extension is logged.
- **EXAM-11** Fixing a key or cancelling a question regrades all submitted attempts, is logged and notifies students.
- **EXAM-12** A started exam cannot be edited except for key fixes/cancellations; editing before start re-copies the snapshot.
- **EXAM-13** Editing the question bank never changes a published or past exam.
- **EXAM-14** Ranks use competition ranking (1, 2, 2, 4) within the attempt's section.
- **EXAM-15** Overall course rank = average % over published Exams with a missed exam as 0%; quizzes excluded; a quiz's own rank uses the best attempt.
- **EXAM-16** The Admin cannot create exams (403); another teacher gets 404.
- **EXAM-17** An attempt is auto-submitted at the deadline even with the browser closed (job), and lazily if the job ran late.
- **EXAM-18** Duration accepts only 15, 30, 45, 60, 90, 120.
- **EXAM-19** (UI) Exam page at 360 px: timer always visible, answers save with a tick, reload resumes with the same order and answers, no animation.
- **EXAM-20** (UI) Student progress page shows marks, %, grade, section rank, trend chart and strong/weak chapters.
