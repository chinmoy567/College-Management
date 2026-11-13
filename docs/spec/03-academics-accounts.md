# 03 · Academics, Accounts & Student 360°

Source: PRD §2.1, §3, §4.4, §4.5, §5.3, §5.3.1, §5.4. All write routes here are **Admin only** and audited unless stated.

## 1. Sessions, groups, sections

| Route | Behaviour |
|---|---|
| `GET /api/academics/sessions` | All sessions with status, groups, section counts, student counts. Admin: all; teacher: sessions they teach/mentor in. |
| `POST /api/academics/sessions` `{ name }` | Transaction: create Session + exactly 3 Groups (science, commerce, arts) + default Section "A" (class 11) in each group (PRD §3.1 "default A"). Name unique, format `^\d{4}[–-]\d{2}$` (store with en dash). |
| `PATCH /api/academics/sessions/:id` `{ name }` | Rename. |
| `POST /api/academics/sessions/:id/close` `{ confirm: true }` | Pass-out (§6). |
| `POST /api/academics/groups/:groupId/sections` `{ name, classLevel }` | Name unique within group + class among non-deleted. |
| `PATCH /api/academics/sections/:id` `{ name?, mentorTeacherId? }` | Mentor change: see §2. |
| `DELETE /api/academics/sections/:id` | Only if 0 active students and no offerings with content; otherwise `409 SECTION_NOT_EMPTY`. Soft delete. |
| `GET /api/academics/sections/:id` | Section page: students, offerings, mentor, free places (`30 − active students`). Admin, mentor, teachers of the section. |

Closed sessions are read-only: every write that targets a closed session's section, offering, routine, exam or student returns `409 SESSION_CLOSED`.

## 2. Section Mentor

- Exactly one mentor per section once assigned; a teacher mentors at most one section (unique `mentorTeacherId`).
- Assign/replace in one transaction: update section → chat membership sync (07 §2.3): new mentor joins section chat + group chat; old mentor leaves them **unless** still a member for another reason (teaches in that section → stays in section chat; mentors another section of the same group → stays in group chat).
- Notify old and new mentor. Pins already created by the old mentor keep `pinSectionId` (PRD §5.7.2).
- Alert on Admin dashboard: sections without a mentor.

## 3. Course catalog & chapters

| Route | Notes |
|---|---|
| `GET/POST /api/academics/courses`, `PATCH /api/academics/courses/:id` | Fields: code (unique), name, groupType, classLevel (`c11/c12/both`), paper, isOptional. Archive instead of delete when used. |
| `GET /api/academics/courses/:id/chapters` | Any logged-in user who can see the course. |
| `POST /api/academics/courses/:id/chapters` `{ name, order? }` | Admin, or a teacher who teaches an offering of this course ("add a chapter to their own course", PRD §5.13). |
| `PATCH/DELETE /api/academics/chapters/:id` | Admin only. Delete only if unused (else `409 CHAPTER_IN_USE`). Reorder: `PUT /api/academics/courses/:id/chapters/order` `{ ids[] }`. |

## 4. Course offerings (assign courses + teachers) — PRD §3.3

- `GET /api/academics/sections/:id/course-suggestions` → catalog courses where `groupType ∈ {section.group.type, common}` and `classLevel ∈ {section.class, both}`, marking those already offered.
- `PUT /api/academics/sections/:id/offerings` `{ items: [{ courseId, teacherId, optionalStudentIds? }] }`
  - Creates missing offerings, updates teachers, ends offerings no longer listed (`endedAt`, enrollments ended; content kept; ending blocked with `409` if an exam is in progress).
  - Teacher dropdown endpoint `GET /api/users/teachers?subject=` returns all active teachers, matching subjects first.
  - Effects (PRD §3.4): teacher sees offering in My Courses, joins section chat, offering appears in the routine builder, teacher notified (`course_assignment_changed`).
- **Change teacher** of an offering (in the same PUT or `PATCH /api/academics/offerings/:id { teacherId }`): content stays with the offering; future `ClassMeeting`s of it with `attendanceTakenAt IS NULL` and `date >= today` get the new `teacherId`; past meetings unchanged. Old teacher leaves section chat unless still teaching/mentoring there.
- **Copy assignments** `POST /api/academics/sections/:targetId/offerings/copy` `{ fromSectionId }` — copies course + teacher pairs that match the target's group/class; never copies students or content. Also used for "from the previous session" (pick a section there).
- **Optional courses** `PUT /api/academics/offerings/:id/students` `{ studentIds[] }` (only `isOptional` courses; default all students of the section): ends/creates enrollments accordingly.

## 5. Accounts

### 5.1 Create

`POST /api/users/students` `{ name, roll, email, sectionId, loginId?, password? }`
`POST /api/users/teachers` `{ name, email, designation?, subjects[], loginId?, password? }`

- **Login ID** generation: students `S-<sessionStartYear>-<4-digit seq>` (e.g. `S-2024-0153`), teachers `T-<4-digit seq>`; unique, editable by Admin.
- Password: typed by Admin or `POST /api/users/generate-password` → 12 chars from an unambiguous alphabet. Stored as argon2. Plain password returned **only in this response** for the credential slip (PRD §4.4); never stored or emailed later.
- Student create = one transaction with a lock on the section row (`SELECT ... FOR UPDATE`): count active students; `>= 30` → `409 SECTION_FULL` with a hint to choose/create another section. Create User + StudentProfile + Enrollment for every non-ended offering of the section (optional courses included by default).
- Section chat + group chat membership added (07 §2.3).

### 5.2 Bulk CSV import

`POST /api/users/import/students` (multipart CSV, max 2 MB, UTF-8 incl. Bangla) columns `name,roll,email,session,group,section` (section matched by `session + group + section name`); teachers: `name,email,designation,subjects` (subjects `;`-separated).
- Two-phase: `?dryRun=true` validates every row and returns `{ valid, errors: [{ row, field, message }] }` (full section, duplicate email/roll, unknown section). Final call re-validates inside **one transaction**; any error → nothing imported (PRD §3.1.1).
- Response includes the credential slips for all created users as a printable PDF (`pdfkit`) and CSV; available for download once (not stored).

### 5.3 Edit, reset, status

| Route | Notes |
|---|---|
| `PATCH /api/users/:id` | name, loginId, email (sets unverified + sends verification), designation, subjects, nameLocked, roll. |
| `POST /api/users/:id/reset-password` `{ password? }` | Returns new plain password once; sets `mustChangePassword` + `firstLogin=true`; revokes sessions. |
| `POST /api/users/:id/deactivate` / `reactivate` | Deactivate: `status=inactive`, revoke sessions, data kept. Reactivate: only if their session is not closed. Inactive students don't count toward 30. |
| `DELETE /api/users/:id` `{ confirmLoginId }` | Anonymise (§5.5). |

### 5.4 Move section & promote 11 → 12 (PRD §4.4)

`POST /api/users/students/move` `{ studentIds[], targetSectionId }` (one, many, or "whole section" = all active students of a section)
- Target must be in the **same session**, not closed; lock target; `active + n > 30` → `409 SECTION_FULL` (nothing moved).
- Per student, one transaction: end active enrollments (`status=ended, endedAt=now`), create enrollments for the target's offerings, update `StudentProfile.sectionId` (class follows the section), swap section chat membership (and group chat if group changes). No attendance rows need changing: records exist only for meetings where attendance was taken, so future meetings simply list the new class roster. Past attendance, attempts and ranks keep their stored `sectionId`.
- Promotion is the same call with a class-12 target; the UI offers "Move whole section" for it. Nothing moves automatically.
- Students with an `in_progress` exam attempt: `409 ATTEMPT_IN_PROGRESS` for that student (move after it ends).

### 5.5 Permanent delete = anonymise (PRD §4.4)

Transaction:
- User: `loginId, email, mobile, passwordHash, avatarId, totp* = null`, `status=deleted`, `anonymisedAt=now`.
- Profile: name → `"Deleted user"`, bio/dob/address/guardian → null.
- Revoke sessions, delete PushSubscriptions, NotificationPrefs, Tokens.
- **Delete all AIConversations** (PRD §5.20).
- Avatar `StorageObject.deletedAt = now` (purged after 30 days).
- Posts/comments/messages stay, shown as "Deleted user" with no profile link.
- AuditLog stores only the user id.

## 6. Pass-out (PRD §4.5)

- `POST /api/academics/sessions/:id/close` and `POST /api/users/students/pass-out` `{ studentIds[] }` (individual).
- Transaction: session `status=closed, closedAt`; every active student of it → `status=passed_out, passedOutAt`; revoke sessions; leave group/section chats (`leftAt`); end in-progress exam attempts by auto-submitting them first.
- Never automatic, never by date.
- Archived data stays readable by Admin; Admin can delete a passed-out student (anonymise).
- Sessions page shows `Active` / `Closed (Passed Out)` badges.

## 7. Student 360° (Admin only) — PRD §5.3.1

- Search: `GET /api/admin/students/search?q=` matches loginId (exact/prefix), name (ILIKE, trigram index `pg_trgm`), roll, mobile. Max 20 results.
- `GET /api/admin/students/:id/360?tab=overview|academic|attendance|exams|community|books|activity` — each tab loads separately (fast on phones).

| Tab | Data source |
|---|---|
| overview | User + StudentProfile + section path, createdAt, lastLoginAt |
| academic | active enrollments with teachers; personal routine (04 §8) |
| attendance | 04 §7 summary + calendar + records + AttendanceEdit history |
| exams | all attempts, marks, grade, rank, integrity logs, trend chart data |
| community | posts, comments, reactions (with target), reports by/against |
| books | BookPurchase list |
| activity | LoginHistory (last 100), password resets (Token used + Admin resets from AuditLog), sanctions |

- **AI chats are never included** (only `AIUsage` counts in Admin reports).
- Quick actions reuse existing routes (reset password, deactivate, move, message, warn/mute, delete post/comment).
- `GET /api/admin/students/:id/360.pdf` – full report (pdfkit), streamed, not stored.
- Teachers and mentors get `GET /api/users/students/:id` limited view: name, photo, loginId, roll, section, their course data. **No mobile, address, DOB, guardian** (PRD §8 Privacy).

## 8. Acceptance

- **ACAD-01** Creating a session makes exactly 3 groups, each with a default Section A; a duplicate session name is rejected.
- **ACAD-02** The 30-student limit holds on create, CSV import and move; two concurrent creates for the last place → only one succeeds; inactive, passed-out and deleted students are not counted.
- **ACAD-03** CSV import with one bad row imports nothing; the dry run lists every row error.
- **ACAD-04** Moving a student ends old enrollments, creates new ones, and keeps the old `sectionId` on past attendance and exam attempts; promotion 11 → 12 works the same way and the class follows the section.
- **ACAD-05** Changing an offering's teacher keeps its content and reassigns only future meetings without attendance.
- **ACAD-06** One mentor per section and one section per mentor; group/section chat membership is synced on mentor and teacher changes.
- **ACAD-07** Copy assignments copies only course + teacher pairs matching the target's group and class.
- **ACAD-08** Optional courses enroll only the chosen students (default: all).
- **ACAD-09** Permanent delete anonymises personal fields, deletes AI chats and keeps posts as "Deleted user".
- **ACAD-10** Pass-out (session or individual) blocks login, removes students from group/section chats and auto-submits running attempts; nothing passes out automatically.
- **ACAD-11** Writes into a closed session return 409 `SESSION_CLOSED`.
- **ACAD-12** Teachers and mentors never receive mobile, address, DOB or guardian info; non-Admins get 404 on Student 360°.
- **ACAD-13** Every Admin write creates an AuditLog row with no personal data.
- **ACAD-14** The plain initial password is returned only once (credential slip) and is never stored or retrievable.
- **ACAD-15** (UI) Admin adds a student at 360 px, sees the credential slip, and can create a new section from the same screen when all are full.
- **ACAD-16** (UI) Student 360° opens from search by ID, name, roll or phone; every tab loads; the PDF export downloads; no AI chats appear.
