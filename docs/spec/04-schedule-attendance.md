# 04 · Schedule Manager, Class Meetings & Attendance

Source: PRD §5.17, §5.17.1, §5.18, §5.11 (online meetings). Skill: `cms-exams-attendance`.
**The Admin decides everything about the schedule** (client decision). Conflicts are warnings only; the system never resolves them.

## 1. Periods & rooms (Admin)

| Route | Rules |
|---|---|
| `GET/POST /api/schedule/periods`, `PATCH /api/schedule/periods/:id` | `name, startTime, endTime` (HH:mm). Editing times affects only meetings created afterwards (past meetings keep copied times). Overlapping periods allowed (warning). |
| `DELETE /api/schedule/periods/:id` `{ replacementPeriodId? }` | If non-deleted routine slots use it: without replacement → `409 PERIOD_IN_USE` + list of slots; with replacement → move those slots. Then soft delete, remove id from every `SpecialDay.periodIds`, regenerate future meetings. |
| `GET/POST /api/schedule/rooms`, `PATCH`, `DELETE /api/schedule/rooms/:id` `{ replacementRoomId? }` | Same pattern as periods. |
| `GET /api/schedule/rooms/usage?date=` | Rooms × periods grid from ClassMeetings (status `scheduled/held`) showing free/used; double-booking flagged. |

## 2. Routine (Admin edits; everyone in scope views)

- `GET /api/schedule/routine?sectionId=` → slots for the section: `{ id, day, period, room, offerings: [{ id, course: { code, name }, teacher }] }`.
- `POST /api/schedule/routine/slots` `{ day, periodId, roomId?, offeringIds[] }`
  - Every offering must be active; several offerings = **combined class** (any sections). The teacher is read from the offerings; a combined slot must have offerings with **one** teacher (else `400 COMBINED_TEACHER_MISMATCH`).
  - Response includes `warnings[]`: teacher double-booked (same day + overlapping period time in another slot), room double-booked. A combined slot is not a teacher double-booking.
- `PATCH /api/schedule/routine/slots/:id` (move day/period/room, change offerings) and `DELETE` (soft delete).
- `POST /api/schedule/routine/copy` `{ fromSectionId, toSectionId }` — copies slots where an offering with the same course exists in the target; returns skipped courses.
- `POST /api/schedule/routine/upload` `{ sectionId, file }` — image/PDF routine (PRD §5.17 alternative), shown above the grid.
- After every routine change: re-run generation for affected offerings for `[today, today+14]` (§4), notify affected students and teachers (`routine_changed`, one notification per user per change batch), audit.

## 3. Calendar: holidays, special days, single-class changes

| Route | Effect on future meetings (no attendance taken) |
|---|---|
| `POST/PATCH/DELETE /api/schedule/holidays` `{ title, startDate, endDate }` | Add: meetings in range → `status=removed`. Delete/shrink: regenerate those dates. |
| `POST/PATCH/DELETE /api/schedule/special-days` `{ date, title, sessionId?, periodIds[] }` | Only slots whose period is listed create meetings that date; others → `removed`. A session-specific special day overrides a college-wide one for that session. |
| `POST /api/schedule/meetings/extra` `{ offeringIds[], date, periodId?, startTime?, endTime?, roomId? }` | Extra class: `routineSlotId=null`. |
| `PATCH /api/schedule/meetings/:id` `{ periodId?, roomId?, date?, substituteTeacherId? }` | Move / room change / substitute (one meeting only). Sets `manuallyEdited=true`. Moving to another date keeps the same row and sets `originalDate` (see note), so the generator never recreates it. |
| `POST /api/schedule/meetings/:id/cancel` | `status=cancelled`; not counted anywhere. Allowed even after attendance (then excluded from %). |
| `DELETE /api/schedule/meetings/:id` | Only future and no attendance → `status=removed` (kept so never regenerated). With attendance → `409 MEETING_HAS_ATTENDANCE` ("cancel it instead"). |

Note: the uniqueness key is `(routine_slot_id, COALESCE(original_date, date))` (expression index, 01 §3), so a moved meeting still blocks regeneration on its original date.

- Past meetings (date < today) are never changed by any of these routes except cancel and attendance edits.
- `GET /api/schedule/calendar?from&to&sessionId&groupId&sectionId&teacherId&roomId` → holidays, special days, meetings (with status) for a month/week view. Admin can click a date/meeting and use the routes above.
- Every change: notify affected users, audit.

## 4. Class Meeting generation (job `meetings.generate`)

Runs nightly at 00:30 Asia/Dhaka for `[today, today+14]` and on demand with `{ offeringIds?, from, to }` after routine/calendar/offering changes.

```
for each date d in range:
  if d in any Holiday → skip all
  for each non-deleted RoutineSlot s with s.day = weekday(d):
    offerings = active offerings of s whose session is not closed
    if offerings empty → skip
    sd = special day for (d, session of offerings) ?? special day for (d, null)
    if sd and s.periodId ∉ sd.periodIds → ensure no scheduled meeting (mark existing future one without attendance as removed); continue
    existing = meeting where routineSlotId = s.id and COALESCE(originalDate, date) = d
    if existing: 
       if existing.status in (removed, cancelled) or attendanceTakenAt not null or existing.manuallyEdited: leave
       else update teacherId, roomId, period times and offerings from the slot  (routine change applies to future)
    else insert meeting(date=d, period copied times, room, teacherId = offering teacher, offerings rows)
  meetings of deleted slots on d with no attendance → removed
```

- Idempotent (uses the unique key + `ON CONFLICT DO NOTHING`), safe to run twice or late.
- Only dates `>= today` are touched.

## 5. Online class ↔ meeting (PRD §5.11)

When a teacher creates/reschedules an online class (08 §1) for offerings O at time T:
- For each offering, find a `scheduled` meeting containing that offering on the same Dhaka date whose `[startTime, endTime)` overlaps T → set its `onlineClassId` (attach).
- Otherwise create an extra meeting (`routineSlotId=null`) for that offering at T with `onlineClassId`.
- Cancelling the online class: detach from attached routine meetings (they stay); remove created extra meetings if no attendance.

## 6. Taking attendance

### 6.1 Endpoints

| Route | Who | Notes |
|---|---|---|
| `GET /api/attendance/today` | teacher | Today's meetings where actor is teacher or substitute, across all sections; status `done / pending`. |
| `GET /api/attendance/pending?from&to` | teacher, mentor (section), Admin (all) | Past meetings with `attendanceTakenAt IS NULL` and status `scheduled` → "Not taken". |
| `GET /api/attendance/meetings/:id/sheet` | `canTakeAttendance` | Header (course code + title, session, group, section, date, period, teacher) + roster per offering (combined class: one list per offering). Roster = students with an enrollment active **on the meeting date** (`enrolledAt <= meeting end` and (`endedAt` null or `> meeting start`)). Existing records override default Present. Online: students in `OnlineClassJoin` → Present, others Absent (pre-fill only). |
| `POST /api/attendance/meetings/:id/sheet` `{ records: [{ studentId, status }], clientDraftId }` | same | Upsert in one transaction; first submit sets `attendanceTakenAt`, `status=held`. Re-submit with changes writes `AttendanceEdit` rows. Students not on the roster → 400. Idempotent by `clientDraftId`. |
| `POST /api/attendance/manual-meeting` `{ offeringId, date, periodId }` | teacher of offering | "Select manually" path: returns the existing meeting for that offering/date/period, or creates an extra meeting. Date ≤ today. |
| `PATCH /api/attendance/records/:id` `{ status }` | teacher (own meetings), mentor (own section), Admin (any) | Writes `AttendanceEdit`; Admin edits also AuditLog. |

- Meetings in the future (start > now + 15 min) cannot be marked. Past meetings can ("missed period", PRD §5.18.3).
- Cancelled or removed meetings cannot be marked.
- Absent → notification `marked_absent` to the student (one per meeting). After each submit, recompute the student's per-course % and notify `attendance_below_threshold` when it crosses below 75% (only on crossing).

### 6.2 Phone UX contract (10-frontend)

Sheet is a single list (photo, roll, name, status chip), everyone Present; tap cycles Present → Absent → Late → Excused; sticky Submit. Draft kept in `localStorage` key `att-draft:<meetingId>` until a `200`; on failure show "Not sent, retry".

## 7. Calculation (PRD §5.18.4)

Per student per offering (and overall across their offerings):

```
records = AttendanceRecord r JOIN ClassMeeting m
          WHERE r.studentId = S AND r.courseOfferingId = O AND m.status = 'held'
          AND m.date NOT IN holidays
present = count(status in (present, late));  excused = count(status = excused)
held    = count(records)
pct     = (held - excused) = 0 ? "N/A" : present / (held - excused) * 100   (1 decimal)
colour  = pct >= threshold (75) → green; >= 60 → orange; else red   (Settings)
```

- Overall = same formula over all of the student's records (not an average of averages).
- Queries run as SQL aggregates; add a materialised view only if the load test needs it.

### 7.1 Views

| Route | Who |
|---|---|
| `GET /api/attendance/me` (summary + per course) · `/me/calendar?month` · `/me/records?courseId&month` | student |
| `GET /api/attendance/offerings/:id/register?month` (students × dates grid), `/summary`, `/low?threshold` | teacher of offering, mentor of section, Admin |
| `GET /api/attendance/sections/:id/summary` · `/not-taken?date` · `/low` | mentor, Admin |
| `GET /api/admin/attendance/summary?by=session|group|section|course|teacher` · `/teachers-not-taken?from&to` | Admin |
| `GET .../register.csv` / `.pdf` (`?sectionId&from&to`) | same scopes |

Calendar day colour: all present / partly absent / absent / no class.

## 8. Routine views

- Student: `GET /api/schedule/me/week` (slots of active enrollments) and `/me/today` (today's meetings with current/next flag, holidays shown).
- Teacher: `GET /api/schedule/me/week` built from all offerings they teach + substitute meetings.
- Mentor: section routine read-only via `GET /api/schedule/routine?sectionId=`.

## 9. Acceptance

- **SCH-01** The generator skips holidays and creates only the listed periods on a special day.
- **SCH-02** Running the generator twice creates no duplicates; it never recreates removed or moved meetings and never touches past meetings or meetings with attendance.
- **SCH-03** A routine change updates future meetings only; past meetings and attendance stay unchanged.
- **SCH-04** A combined slot creates one meeting covering all its offerings and gives no teacher double-booking warning.
- **SCH-05** Teacher and room double-bookings return warnings and never block the save.
- **SCH-06** Deleting a used period or room without a replacement → 409; with a replacement the slots move; deletes are soft.
- **SCH-07** Deleting a future meeting with attendance → 409 (cancel instead); without attendance it becomes `removed`.
- **SCH-08** Only the Admin can change periods, rooms, routine, holidays, special days and single classes; everyone else gets 403.
- **SCH-09** Attendance: another teacher is denied, the substitute is allowed, the mentor is allowed for their section, the Admin is allowed, a student is denied.
- **SCH-10** Re-submitting the same sheet is idempotent; changes create AttendanceEdit rows (and AuditLog for the Admin).
- **SCH-11** % formula: late counts as present, excused is excluded, cancelled meetings are not counted, "N/A" when nothing counts, a student who moved is measured only on their own records.
- **SCH-12** The roster lists only students whose enrollment was active on the meeting date; optional courses list only enrolled students.
- **SCH-13** An online class at a routine time attaches to that meeting instead of creating a second one.
- **SCH-14** Absent students are notified; the below-75% notification fires only when the % crosses below the threshold.
- **SCH-15** (UI) Attendance sheet at 360 px: everyone Present by default, tap cycles status, Submit is sticky, a failed submit keeps the draft and shows "Not sent, retry".
- **SCH-16** (UI) Student attendance card shows overall and per-course % with correct colours; the calendar colours days and shows periods on tap.
- **SCH-17** (UI) Admin Schedule Manager: add a holiday and an extra class from the calendar, see them on the student routine.
