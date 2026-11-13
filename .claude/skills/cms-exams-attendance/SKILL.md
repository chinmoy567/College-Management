---
name: cms-exams-attendance
description: Implement or review exams/quizzes, scoring, exam progress and per-period attendance for the College Management System. Use for any change in exams, attendance, routine or class meetings.
---

# CMS exams and attendance

Source: `docs/PRD.md` §5.14-5.15 exams, §5.17 routine, §5.18 attendance. Build from `docs/spec/04-schedule-attendance.md` and `docs/spec/05-exams-progress.md` and their plans in `docs/implementation/`.

## Exams
- Scoring: right = marks, wrong = 0. No negative or partial marks (client decision).
- Score on the server only. Correct answers are sent only after reveal + results published + `showAnswersAfterEnd` (spec 05 §4.3).
- Exam = 1 attempt; quiz = 1-10 or unlimited, next attempt only after submit; at most one attempt in progress.
- Enforce `deadline_at` and the attempt limit on every answer and submit, in one transaction. Late answers are rejected; the auto-submit job is cleanup only.
- Exam page: timer always visible, no animation, one-handed on a phone, answers saved as the student goes.
- Unique constraint: one answer per question per attempt.

## Routine and attendance
- The Admin decides rooms, periods, routine, holidays, cancelled/re-created meetings and conflicts. Do not invent conflict rules.
- Attendance is per Class Meeting (period). Allowed: the meeting's teacher, the substitute, the Section Mentor of a covered section, the Admin. Edits write `AttendanceEdit` (+ AuditLog for the Admin).
- One row per student + meeting; marking is idempotent.
- Times UTC, shown Asia/Dhaka. Phone UI: one list, everyone Present by default, tap cycles Present → Absent → Late → Excused, sticky Submit, draft kept until sent.

## Tests required
Scoring, deadline edge (before/after), duplicate submit, attempt limit, attendance permission denied/allowed, duplicate attendance mark.
