# Plan 03 · Academics, Accounts & Student 360° (Milestone M3, 360° finished in M11)

Spec: `docs/spec/03-academics-accounts.md` · PRD §2.1, §3, §4.4, §4.5, §5.3, §5.3.1, §5.4. Agents: `api-builder`, `db-architect`. Skills: `cms-backend`, `cms-new-module`.
Goal: the academic tree and every account lifecycle operation, with the 30-student limit unbreakable.

## 1. Build order

1. **Permission helpers** (finish `lib/permissions.ts`): `teachesOffering`, `mentorsSection`, `teachesInSection`, `canManageOffering`, `isEnrolled`, `canTakeAttendance`, `canSeeStudentPrivate`. Each is one indexed query; add a per-request memo (`req.actorCache`) so a route that checks twice doesn't query twice. Allow + deny tests now (CONV-08).
2. **`closedSessionGuard(sectionId|offeringId|…)`** service helper → `409 SESSION_CLOSED` (ACAD-11). Every write service in 03/04/05/08 calls it; a test table lists every write route and asserts 409 for a closed session.
3. **Sessions / groups / sections** (§1): create session = one transaction (Session + 3 Groups + Section A class 11 each + group conversations + section conversations). Name regex, store with en dash.
4. **Mentor** (§2): unique `mentorTeacherId`; assign/replace in one transaction → `chatMembership.sync()` for old and new mentor → `notify()` both. Dashboard alert query: sections without mentor.
5. **Catalog & chapters** (§3): archive-not-delete; chapter add by Admin or teacher of an offering of that course; reorder endpoint.
6. **Offerings** (§4): `PUT /sections/:id/offerings` as a **diff** (create / update teacher / end) in one transaction; ending blocked if an exam is in progress; teacher change reassigns only future meetings without attendance (raw `UPDATE … WHERE date >= dhakaToday() AND attendance_taken_at IS NULL`); copy assignments; optional-course students.
7. **Login ID + password generator**: per-session sequence via `SELECT max(...) FOR UPDATE` on a small counter row (`Setting` key `login_seq:<year>`) — avoids gaps/races. Password generator: 12 chars, unambiguous alphabet, `crypto.randomInt`.
8. **Create student** (§5.1): `SELECT id FROM sections WHERE id=$1 FOR UPDATE` → count active students → `SECTION_FULL` or create User + StudentProfile + Enrollments + chat membership in one transaction. Plain password returned once in the response body, never logged (logger redact covers `password`).
9. **CSV import** (§5.2): `csv-parse` with BOM handling (Excel Bangla), dry run returns every row error; final run re-validates inside one transaction with all section locks taken **in sorted id order** (avoid deadlocks). Credential slips PDF via pdfkit + embedded Noto Sans Bengali; CSV alternative. Streamed, not stored.
10. **Edit / reset / deactivate / reactivate / anonymise** (§5.3, §5.5): each calls `revokeAllSessions` + `audit`. Anonymise in one transaction incl. `AIConversation` delete and avatar `StorageObject.deletedAt`.
11. **Move & promote** (§5.4): target lock, `active + n > 30` → nothing moved; per-student transaction; `ATTEMPT_IN_PROGRESS` check; class follows the section.
12. **Pass-out** (§6): session close or individual; auto-submit in-progress attempts first (calls the exam `finaliseAttempt()` — until M7 it's a no-op stub because attempts can't exist yet; wired for real in M7 and its test added then).
13. **Teacher limited student view** `GET /api/users/students/:id` with a dedicated serializer (no private fields, ACAD-12).
14. **Student 360° (M3 part)**: search (trigram) + overview + academic tabs + 404 for non-Admins. Remaining tabs and the PDF in **M11** once their data exists.
15. **Screens** (`web-builder`): sessions list/detail, section page with free places, Assign Courses sheet, catalog, teachers/students lists as cards, add student form with credential slip print view + "create new section" inline when all full (ACAD-15), CSV import with dry-run table, mentors page.

## 2. Senior notes

- **Concurrency test for ACAD-02:** fire two `create student` requests in parallel for the 30th place with `Promise.all`; exactly one 201, one 409. Same for move and import.
- **What "active student" means** is a single SQL fragment (`status='active'`) in one helper, so inactive/passed-out/deleted never count.
- **Audit `changes` never contains personal data:** `audit()` takes an allow-list of keys per action; a test greps all `audit(` calls' change keys against a deny list (`email`, `mobile`, `name`, `password`, `dob`, `address`).
- **Chat membership** is computed (`desired set` vs `current set`), not incrementally patched — robust against any ordering of moves and mentor changes.
- Teacher dropdown `GET /api/users/teachers?subject=` orders matching subjects first with `ORDER BY (subjects && $1) DESC, name`.

## 3. Acceptance → tests

| ID | Test |
|---|---|
| ACAD-01 | `[ACAD-01] session creates 3 groups with Section A; duplicate name rejected` |
| ACAD-02 | `[ACAD-02] 30-limit on create/import/move; concurrent last place; inactive not counted` |
| ACAD-03 | `[ACAD-03] one bad CSV row imports nothing; dry run lists every error` |
| ACAD-04 | `[ACAD-04] move ends/creates enrollments, keeps old sectionId on history; promotion 11→12` (attempt part completed in M7) |
| ACAD-05 | `[ACAD-05] teacher change keeps content, reassigns only future meetings without attendance` (meetings inserted directly by factory) |
| ACAD-06 | `[ACAD-06] one mentor per section / section per mentor; chat membership synced` |
| ACAD-07 | `[ACAD-07] copy assignments only matching group/class` |
| ACAD-08 | `[ACAD-08] optional course enrolls chosen students (default all)` |
| ACAD-09 | `[ACAD-09] anonymise fields, delete AI chats, posts as Deleted user` |
| ACAD-10 | `[ACAD-10] pass-out blocks login, leaves chats, auto-submits attempts, never automatic` (attempt part in M7) |
| ACAD-11 | `[ACAD-11] writes into closed session → 409 SESSION_CLOSED` (route table) |
| ACAD-12 | `[ACAD-12] teacher/mentor payload has no private fields (snapshot); 360° → 404 for non-admin` |
| ACAD-13 | `[ACAD-13] every admin write audited without personal data` |
| ACAD-14 | `[ACAD-14] plain password returned once, not stored or retrievable` |
| ACAD-15 | Playwright `[ACAD-15] add student at 360 px, slip, new section when full` |
| ACAD-16 | Playwright `[ACAD-16] Student 360° search, all tabs, PDF, no AI chats` — **M11** |

## 4. Definition of done

M3: ACAD-01..15 green (ACAD-04/10 attempt clauses re-verified in M7), "30-student limit and enrollment history tested", `/spec-check 03` shows only ACAD-16 pending (M11). M11: ACAD-16 green → `/spec-check 03` complete.
