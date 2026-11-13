# Plan 04 · Schedule Manager, Class Meetings & Attendance (Milestone M5)

Spec: `docs/spec/04-schedule-attendance.md` · PRD §5.17, §5.17.1, §5.18, §5.11. Agent: `exam-attendance-builder`. Skill: `cms-exams-attendance`.
Client rule: **the Admin decides everything about the schedule.** Conflicts are warnings, never blocks, never auto-resolved.

## 1. Core design

The heart of this spec is the **Class Meeting** row: routine slots are templates, meetings are concrete classes on a date, attendance hangs off meetings. Three invariants drive every design choice:
1. The past is immutable (except cancel and attendance edits).
2. A meeting with attendance is never touched by the generator.
3. A meeting the Admin removed or moved is never recreated (unique key on `COALESCE(original_date, date)`).

## 2. Build order

1. **Pure generator first** (`modules/schedule/generator.ts`): a pure function `plan(dateRange, slots, holidays, specialDays, existingMeetings, today) → { inserts, updates, removals }`. Exhaustive unit tests (holiday, special day college/session override, combined slot, deleted slot, moved meeting, manually edited, attendance taken, past date). This makes SCH-01/02/03 cheap to prove.
2. **Generator executor** (`jobs/meetings.generate.ts`): loads inputs, runs `plan`, applies in one transaction; inserts via raw SQL with `ON CONFLICT (routine_slot_id, (COALESCE(original_date, date))) WHERE routine_slot_id IS NOT NULL DO NOTHING`. Cron 00:30 Dhaka for `[today, today+14]`, plus on-demand with `{ offeringIds?, from, to }` and a pg-boss `singletonKey` so bursts of edits coalesce.
3. **Periods & rooms** (§1) with replacement-on-delete, soft delete, `SpecialDay.periodIds` cleanup; room usage grid.
4. **Routine** (§2): slot CRUD, combined-class teacher check (`COMBINED_TEACHER_MISMATCH`), `warnings[]` computation (teacher/room overlap by time, not just period id — overlapping periods are allowed), copy, upload (image/PDF via storage). After each change: enqueue generation, `notify(routine_changed)` batched one per user per change batch, audit.
5. **Calendar** (§3): holidays, special days, extra classes, single-meeting edits (`manuallyEdited`, `originalDate`), cancel, delete (`MEETING_HAS_ATTENDANCE`). Calendar read endpoint with filters.
6. **Online class hook** (§5): `attachOrCreateMeeting(onlineClass)` / `detach()` — implemented now as a service, called by 08 in M6.
7. **Attendance** (§6): today / pending / sheet GET (roster = enrollment active on the meeting date, combined class = one list per offering, online pre-fill from `OnlineClassJoin`) / sheet POST (upsert, `AttendanceEdit` on changes, idempotent by `clientDraftId`, time window ≤ start + 15 min rule, no cancelled/removed) / manual meeting / record PATCH.
8. **Calculation** (§7) as one SQL aggregate (`count(*) FILTER (WHERE …)`) in `attendance/stats.ts`; pure formatter `pct(present, held, excused)` with "N/A" and colour bands from Settings. Crossing-below-threshold notification: compute before/after inside the submit transaction for affected students only.
9. **Views** (§7.1, §8): student summary/calendar/records; offering register (students × dates); section summary/not-taken/low; Admin summaries; CSV/PDF export (streamed); routine week/today views for student, teacher, mentor.
10. **Screens**: Admin Schedule Manager (Calendar month/week, Routine day-by-day list on phones / grid on `lg`, Periods, Rooms, Holidays, Special days, Room usage); teacher Today list + Attendance sheet + manual select; student attendance card + calendar; routine pages.

## 3. Senior notes

- **Weekday from Dhaka date** only (`weekdayOf(dhakaDate)`), never `new Date().getDay()`.
- **Teacher on a meeting** is copied at generation; teacher change in 03 updates future unattended meetings — the generator update branch must also refresh `teacherId` from the slot's offering for non-edited future meetings (consistent both ways).
- **Substitute** stored on the meeting; `canTakeAttendance` covers teacher, substitute, mentor of a covered section, Admin.
- **Idempotent submit:** store `clientDraftId` on the meeting's last submit; same id + same payload → return stored result, no `AttendanceEdit` rows.
- **Sheet UX contract** (§6.2): `localStorage` draft `att-draft:<meetingId>`, cleared only on 200; sticky submit; tap cycles status. No list animation (long lists on low-end phones).
- **Notifications fan-out** for routine changes can be large (a whole section × teachers) — insert notifications with `createMany` and one socket emit per user.
- Attendance % for a moved student uses **their own records** only (records carry `courseOfferingId`; old section's offerings simply stop accruing).

## 4. Acceptance → tests

| ID | Test |
|---|---|
| SCH-01 | `[SCH-01] generator skips holidays, special day only listed periods` (unit + integration) |
| SCH-02 | `[SCH-02] run twice no duplicates; never recreates removed/moved; never touches past/attended` |
| SCH-03 | `[SCH-03] routine change updates only future meetings` |
| SCH-04 | `[SCH-04] combined slot one meeting, no teacher double-booking warning` |
| SCH-05 | `[SCH-05] teacher/room double-booking warns, never blocks` |
| SCH-06 | `[SCH-06] delete used period/room 409 without replacement; with replacement moves; soft` |
| SCH-07 | `[SCH-07] delete meeting with attendance 409; without → removed` |
| SCH-08 | `[SCH-08] only admin edits schedule (route table, 403 for teacher/student)` |
| SCH-09 | `[SCH-09] attendance permission matrix` |
| SCH-10 | `[SCH-10] resubmit idempotent; changes → AttendanceEdit (+AuditLog for admin)` |
| SCH-11 | `[SCH-11] % formula cases` (unit on formatter + SQL integration) |
| SCH-12 | `[SCH-12] roster by enrollment active on meeting date; optional courses` |
| SCH-13 | `[SCH-13] online class at routine time attaches to the meeting` (service test now, end-to-end in M6) |
| SCH-14 | `[SCH-14] absent notified; below-75 notification only on crossing` |
| SCH-15 | Playwright `[SCH-15] attendance sheet at 360 px, draft kept on failure` (route-intercept to fail the POST) |
| SCH-16 | Playwright `[SCH-16] student attendance card colours + calendar` |
| SCH-17 | Playwright `[SCH-17] admin adds holiday + extra class, student routine shows them` |

## 5. Definition of done (M5)

"Generation is idempotent; % rules tested" — SCH-01/02/11 green; all SCH IDs green (SCH-13 fully at M6); `/spec-check 04` complete.
