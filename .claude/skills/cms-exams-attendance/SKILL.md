---
name: cms-exams-attendance
description: Implement or review exams/quizzes, scoring, exam progress and per-period attendance for the College Management System. Use for any change in exams, attendance, routine or class meetings.
---

# CMS exams and attendance

Source: `docs/PRD.md` §5.14-5.15 exams, §5.17 routine, §5.18 attendance.

## Exams
- Scoring: right = marks, wrong = 0. No negative or partial marks (client decision).
- Score on the server only; never send correct answers to the client before the PRD allows it.
- Enforce `deadline_at` and the attempt limit on every answer and submit, in one transaction. Late answers are rejected; the auto-submit job is cleanup only.
- Exam page: timer always visible, no animation, one-handed on a phone, answers saved as the student goes.
- Unique constraint: one answer per question per attempt.

## Routine and attendance
- The Admin decides rooms, periods, routine, holidays, cancelled/re-created meetings and conflicts. Do not invent conflict rules.
- Attendance is per period / Class Meeting; only the assigned teacher or mentor can mark it; late edits follow the PRD.
- One row per student + meeting; marking is idempotent.
- Times UTC, shown Asia/Dhaka. Phone UI: a fast list with big present/absent toggles.

## Tests required
Scoring, deadline edge (before/after), duplicate submit, attempt limit, attendance permission denied/allowed, duplicate attendance mark.
