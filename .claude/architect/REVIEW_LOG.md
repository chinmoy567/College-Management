# Architect Review Log — College Management System

> Rebuilt on 2026-11-14 from the architect's review reports (the original file was found empty).
> ARC-034 to ARC-036 could not be recovered; they were logged during a review whose report did not list them.

## Issue summary

| ID      | Title                                        | Severity | Location                          | First seen | Status                        |
| ------- | -------------------------------------------- | -------- | --------------------------------- | ---------- | ----------------------------- |
| ARC-001 | Pin audience by group, should be section     | High     | PRD §6 Post                       | 2026-11-13 | Fixed (v2.8)                  |
| ARC-002 | Admin attendance: view-only vs edit          | Medium   | PRD §2.1 vs §5.18.3               | 2026-11-13 | Open                          |
| ARC-003 | Group rank cannot be computed                | High     | PRD §5.15                         | 2026-11-13 | Fixed (v2.7)                  |
| ARC-004 | Phase contradictions                         | Medium   | PRD §5.2, §5.9, §5.10, §5.20, §10 | 2026-11-13 | Open                          |
| ARC-005 | Missing entities in data model               | High     | PRD §6                            | 2026-11-13 | Mostly fixed (v2.12)          |
| ARC-006 | ClassMeeting courses stored as array         | High     | PRD §6                            | 2026-11-13 | Partly fixed (v2.10)          |
| ARC-007 | Exam scoring gaps                            | High     | PRD §5.14                         | 2026-11-13 | Fixed (v2.13)                 |
| ARC-008 | Class 11/12 stored in two places             | Medium   | PRD §6 StudentProfile             | 2026-11-13 | Open                          |
| ARC-009 | Enrollment meaning is contradictory          | Medium   | PRD §2.4 vs §6                    | 2026-11-13 | Fixed (v2.14)                 |
| ARC-010 | Section Mentor scope unclear                 | Medium   | PRD §2.1                          | 2026-11-13 | Open                          |
| ARC-011 | Child safety in 1-to-1 messaging             | High     | PRD §5.8                          | 2026-11-13 | Closed (all users 18+, v2.13) |
| ARC-012 | Decision #13 cites numbers that don't exist  | Low      | PRD §11                           | 2026-11-13 | Open                          |
| ARC-013 | Repo hygiene                                 | Medium   | repo root                         | 2026-11-13 | Open                          |
| ARC-014 | PRD not in git                               | Critical | commit 6482bc2                    | 2026-11-13 | Fixed (f566d54)               |
| ARC-015 | .gitignore wrong both ways                   | High     | .gitignore                        | 2026-11-13 | Fixed (v2.12)                 |
| ARC-016 | Misleading commit message                    | Low      | commit 6482bc2                    | 2026-11-13 | Open (process)                |
| ARC-017 | Gemini API terms forbid under-18 users       | Critical | PRD §5.20, Decision #9            | 2026-11-13 | Fixed (v2.13, Groq confirmed) |
| ARC-018 | Privacy rule contradicts itself              | High     | PRD §8 vs §5.3.1                  | 2026-11-13 | Fixed (v2.13)                 |
| ARC-019 | Attendance calendar & calculation gaps       | High     | PRD §5.18                         | 2026-11-13 | Fixed (v2.13)                 |
| ARC-020 | Section move loses history                   | High     | PRD §4.4, §5.3, §6                | 2026-11-13 | Fixed (v2.14)                 |
| ARC-021 | Correct answers leak during exam window      | High     | PRD §5.14.1                       | 2026-11-13 | Open                          |
| ARC-022 | Exam window vs duration; live bank questions | Medium   | PRD §5.14, §6                     | 2026-11-13 | Open                          |
| ARC-023 | Every Admin/Mentor post auto-pins            | Medium   | PRD §5.7.2                        | 2026-11-13 | Fixed (v2.9)                  |
| ARC-024 | Timezone never stated                        | Medium   | PRD §8                            | 2026-11-13 | Open                          |
| ARC-025 | SMTP daily limits                            | Medium   | PRD §5.9                          | 2026-11-13 | Open (client)                 |
| ARC-026 | Single Admin, no recovery                    | Low      | PRD §2                            | 2026-11-13 | Open                          |
| ARC-027 | No Period/Room entities                      | Low      | PRD §6                            | 2026-11-13 | Open                          |
| ARC-028 | Public repo contains client PRD              | Medium   | GitHub                            | 2026-11-13 | Open (client)                 |
| ARC-029 | Public profile of inactive users undefined   | Low      | PRD §5.7.1 vs §4.4                | 2026-11-13 | Open                          |
| ARC-030 | Student ID on public profile                 | Low      | PRD §5.7.1                        | 2026-11-13 | Open (client)                 |
| ARC-031 | "Seen" definition vague                      | Medium   | PRD §5.7.2                        | 2026-11-14 | Fixed (v2.9)                  |
| ARC-032 | Extend pin vs already seen                   | Medium   | PRD §5.7.2                        | 2026-11-14 | Fixed (v2.9)                  |
| ARC-033 | Dashboard vs feed seen tracking              | Low      | PRD §5.2.3 vs §5.7.2              | 2026-11-14 | Fixed (v2.9)                  |
| ARC-037 | Duplicate version 2.9                        | Low      | PRD revision history              | 2026-11-14 | Fixed (v2.10)                 |
| ARC-038 | Stale pin wording in §5.3 / §5.4             | Low      | PRD §5.3, §5.4                    | 2026-11-14 | Fixed (v2.10)                 |
| ARC-039 | Flow C missing pin switch                    | Low      | PRD §7                            | 2026-11-14 | Fixed (v2.10)                 |
| ARC-040 | Unpinned Admin/Mentor posts: notification?   | Medium   | PRD §5.10                         | 2026-11-14 | Fixed (v2.10)                 |
| ARC-041 | HSC age claim conflicts with typical ages   | Medium   | PRD §1                            | 2026-11-14 | Open (client-confirmed)       |

---

## Issue details

### 🔴 Critical

**ARC-017 — Gemini API terms forbid under-18 users** · PRD §5.20, §9, Decision #9 · Fixed (v2.13)

- **Problem:** The Gemini API Additional Terms say users must be 18 or older, and the API must not be used in an app "directed towards or likely to be accessed by" people under 18. HSC Class 11–12 students are mostly 16–18.
- **Fix applied in v2.11:** Switched to Groq free tier. Groq does not train on inputs, and its terms allow apps used by minors (college responsible).
- **Client confirmation in v2.13:** Client confirmed all students are 18+, so Groq stays. Open question 1 removed from §11. See ARC-041 for age claim verification.

**ARC-014 — PRD not in git** · commit 6482bc2 · Fixed (f566d54)

- **Problem:** Commit 6482bc2 deleted `PRD.md` from the root; the only copy was in the git-ignored `.claude/` folder.
- **Fix applied:** PRD.md restored to the root and committed. Versions 2.7–2.10 are committed too.

### 🟠 High

**ARC-005 — Missing entities in data model** · PRD §6 · Mostly fixed (v2.13)

- **Problem:** Many features in §5 require entities not listed in §6: configurable settings (attendance threshold, grading scale, AI provider/model/limits, pin length), activity tracking (login history, AI usage per student per day), moderation (warn/mute sanctions, banned words), messaging (block list), audit trail (Admin actions), recording and material view counts.
- **Fixed in v2.12:** Added Settings, AIUsage, AuditLog, LoginHistory, UserSanction, Block, BannedWord, RecordingProgress, MaterialView.
- **Fixed in v2.13:** Added Holiday entity.
- **Still missing:** Period/Room (ARC-027, low priority).

**ARC-006 — ClassMeeting courses stored as an array** · PRD §6 · Partly fixed (v2.10)

- **Problem:** `ClassMeeting.course_offering_ids[]` was an array, and nothing stopped the routine from generating the same meeting twice.
- **Fixed in v2.10:** `ClassMeetingOffering` join table with a unique meeting + offering rule; routine changes apply to future classes only.
- **Still open:** add an explicit unique rule `UNIQUE(routine_slot_id, date)` on ClassMeeting so the same routine slot can never create two meetings on one day.

**ARC-007 — Exam scoring gaps** · PRD §5.14 · Fixed (v2.13)

- **Problem:** No rule for: partial marks on multi-correct MCQs; how negative marking works with multi-correct; which attempt counts (best, last or first) when a quiz allows several attempts.
- **Fix applied in v2.13:** Single-correct: full marks if correct, negative marks if set, 0 if unanswered. Multi-correct: all-or-nothing (full marks only if exactly all correct options selected and no wrong ones), no negative marks. Student total never goes below 0. Quizzes with multiple attempts: best attempt counts for progress and rank.

**ARC-011 — Child safety in 1-to-1 messaging** · PRD §5.8 · Fixed (v2.13)

- **Problem:** Students and teachers can message minors 1-to-1 freely, and the Admin can only see chats that someone reports.
- **Fix applied in v2.13:** Client confirmed all students are 18 or older; no minors on the portal. §5.8 now states "All users are adults (18+), so 1-to-1 chat is open to everyone as listed above; no extra minor-protection rules are needed." Block/report available from every chat. See ARC-041 for age claim verification.

**ARC-018 — Privacy rule contradicts itself** · PRD §8 vs §5.3.1 · Fixed (v2.13)

- **Problem:** §8 said mobile, address and guardian info are visible to "their teachers"; §5.3.1 said teachers see only profile and course data.
- **Fix applied in v2.13:** §8 now says "Students' personal details (mobile, address, guardian info, DOB) visible **only to the student and the Admin**. Teachers and Section Mentors see only profile and course data (Section 5.3.1)."

**ARC-019 — Attendance calendar and calculation gaps** · PRD §5.18 · Fixed (v2.13)

- **Problem:** No Holiday entity, so the routine generates meetings on holidays. "Classes held" not defined for meetings where nobody took attendance. Held − Excused = 0 divides by zero.
- **Fix applied in v2.13:** Holiday entity added (id, start_date, end_date, title, created_by). §5.17 says Admin marks holidays; no Class Meetings generated on those days; future meetings on new holiday dates (with no attendance) are removed. §5.18.4: "Classes held" = meetings where attendance was taken; a meeting with no attendance taken is not counted and shows as "Not taken" to teacher/Section Mentor/Admin. If Classes held − Excused = 0, the percentage shows "N/A".

**ARC-020 — Moving section or class loses history** · PRD §4.4, §5.3, §6 · Fixed (v2.14)

- **Problem:** Enrollment had no start/end date or status, and AttendanceRecord / ExamAttempt did not store which section the student was in.
- **Fix applied in v2.14:** Enrollment now `(id, course_offering_id, student_id, status (active/ended), enrolled_at, ended_at)` with "a row for **every** student in every offering they take; ending keeps history; only one active row per student + offering." AttendanceRecord and ExamAttempt now store `section_id` (section at the time of the record). §4.4 says moving a student ends old enrollments and creates new ones; past attendance, exam attempts and ranks stay with the section the student was in at that time.

**ARC-021 — Correct answers leak during the exam window** · PRD §5.14.1 · Open

- **Problem:** "Show correct answers after submission" lets the first student who submits see the answers and share them while others are still taking the exam.
- **Fix:** Correct answers are shown only after the exam's `end_at` has passed, never right after one student submits.

**ARC-041 — HSC age claim conflicts with typical ages** · PRD §1 · Open (client-confirmed)

- **Problem:** v2.13 says "all students are 18 or older (confirmed by the client)" but HSC Class 11-12 students are typically ages 16-17 in Bangladesh. Class 11 starts after SSC (age ~16), Class 12 ends at ~17-18.
- **Why it matters:** This is either (1) an adult HSC program (distance learning, second-chance education), or (2) a factual error. If it is a standard HSC college, the age claim is false, and the Groq/privacy decisions based on it are invalid.
- **Fix:** Ask the client to clarify: Is this an adult education HSC program, or are there actually students under 18? If the latter, ARC-011 and ARC-017 must be reopened (child safety, AI provider terms). If the former, consider adding "adult education" to §1 to make it clear.

### 🟡 Medium

**ARC-002 — Admin attendance: view-only vs edit** · PRD §2.1 vs §5.18.3 · Open

- **Problem:** The permission matrix says Admin can "View all" attendance; §5.18.3 says Admin "can edit any record".
- **Fix (recommended):** Admin can edit any record, and every edit is saved in AttendanceEdit. Update the matrix.

**ARC-004 — Phase contradictions** · PRD §5.2, §5.9, §5.10, §5.20, §10 · Open

- **Problem:** Browser push is Phase 2 in §5.10 but Phase 3 in §10. AI grounded in notes is Phase 2 in §5.20 but Phase 3 in §10. Notice emails for Important/Urgent are in a Phase 1 feature (§5.9), but "email notifications" are Phase 3. Phase 1 dashboards show attendance/exams that only arrive in Phase 2.
- **Fix:** Make §10 the single source for phases and fix the other sections. Phase 1 dashboards hide widgets for features not built yet.

**ARC-008 — Class 11/12 stored in two places** · PRD §6 · Open

- **Problem:** `StudentProfile.class` repeats information that belongs to the session; Session has no "current class" field.
- **Fix:** Put `current_class` on Session and remove `class` from StudentProfile. Promotion to Class 12 = one update on the session.

**ARC-009 — Enrollment meaning is contradictory** · PRD §2.4 vs §6 · Fixed (v2.14)

- **Problem:** §6 said Enrollment is "for optional courses"; §2.4 said students are auto-enrolled in every course offering.
- **Fix applied in v2.14:** §6 now says "a row for **every** student in every offering they take", not just optional courses. This aligns with §2.4 and is needed for the history tracking in ARC-020.

**ARC-010 — Section Mentor scope unclear** · PRD §2.1 · Open

- **Problem:** The matrix gives Section Mentors ✅ on recordings, notes and previous questions with no "own section" limit.
- **Fix:** State the scope: view only, for their own section's offerings.

**ARC-013 — Repo hygiene** · repo root · Open

- **Problem:** `nothing.txt` was committed as a stray file (it now has content added by the developer). No README, no `.env.example`.
- **Fix:** Delete or rename `nothing.txt` to something meaningful; add a short README and `.env.example` when scaffolding.

**ARC-022 — Exam window vs duration; live bank questions** · PRD §5.14, §6 · Open

- **Problem:** A student who starts at 9:50 in an 8–10 PM window with a 40-minute exam: the PRD does not say if time is cut at 10:00. Also, ExamQuestion points to live question-bank rows, so editing a bank question changes past exams.
- **Fix:** Rule: end time = earlier of (start + duration) and window end. Snapshot question text, options and answer into the exam when it is published.

**ARC-024 — Timezone never stated** · PRD §8 · Open

- **Problem:** Routine, exams, attendance and pin expiry all depend on time, but the timezone is not written anywhere.
- **Fix:** Add to §8: all times shown in Asia/Dhaka, stored in UTC.

**ARC-025 — SMTP daily limits** · PRD §5.9 · Open (client)

- **Problem:** Important/Urgent notice emails to ~3,000 users may hit SMTP daily limits (a personal Gmail is about 500/day).
- **Fix:** Ask which SMTP provider the client will use; use a queue with rate limiting.

**ARC-028 — Public repo contains client PRD** · GitHub · Open (client)

- **Problem:** The GitHub repo is PUBLIC and its history contains the client's PRD v1.0 (and now v2.7–2.10).
- **Fix:** Ask the client. If not OK, make the repo private.

### 🔵 Low

**ARC-012 — Decision #13 cites numbers that don't exist** · PRD §11 · Open

- **Problem:** "Requirement numbers 14, 15, 16 and 23 were removed" — the PRD has no numbered requirements, so this confuses any future reader.
- **Fix:** Reword or remove the decision.

**ARC-016 — Misleading commit message** · commit 6482bc2 · Open (process)

- **Problem:** "add .gitignore and create nothing.txt file" hid the deletion of the PRD.
- **Fix:** One topic per commit, and describe what the commit really does.

**ARC-026 — Single Admin, no recovery** · PRD §2 · Open

- **Problem:** Only one Admin account, with no second Admin or recovery path if the email is lost.
- **Fix:** Allow a second Admin or a documented server-side recovery script.

**ARC-027 — No Period/Room entities** · PRD §6 · Open

- **Problem:** The routine grid needs period numbers and times per college, and possibly rooms, but there are no entities for them.
- **Fix:** Add `Period(number, start_time, end_time)` and optional `Room`.

**ARC-029 — Public profile of inactive users undefined** · PRD §5.7.1 vs §4.4 · Open

- **Problem:** Posts by passed-out or deactivated students stay visible, but the PRD does not say what their public profile shows.
- **Fix:** "For passed-out or deactivated users, the profile shows name, photo and a note that the account is no longer active; nothing else."

**ARC-030 — Student ID on public profile** · PRD §5.7.1 · Open (client)

- **Problem:** Student ID + name + session + section on the public profile lets anyone identify a student outside the platform.
- **Note:** v2.13 confirmed all users are 18+, so this is no longer a child-protection issue, but remains a general privacy question.
- **Fix:** Ask the client whether Student ID should be on the public profile or only for Admin/teachers.

### ✅ Fixed (short)

- **ARC-001** — Pin audience now `pin_section_id` (null = everyone) + PostView entity (v2.8).
- **ARC-003** — Ranks are section-only; group rank removed (v2.7).
- **ARC-005** — 9 missing entities added (Settings, AIUsage, AuditLog, LoginHistory, UserSanction, Block, BannedWord, RecordingProgress, MaterialView) in v2.12; Holiday/Period/Room still missing but documented in other issues.
- **ARC-014** — PRD.md restored to root and committed (f566d54).
- **ARC-015** — .gitignore rewritten: removes `.claude` ignore (so agents/ and architect/ are committed), keeps .env ignored, adds .env.example, ignores only settings.local.json, plus proper ignores for node_modules/.next/dist/build/coverage/uploads/*.log (v2.12).
- **ARC-017** — AI switched from Gemini to Groq (allows minors, no training on data); client confirmed Groq and 18+ claim (v2.13).
- **ARC-023** — "Pin this post" switch, on by default; pin audience fixed at creation (v2.9).
- **ARC-031** — Seen = at least half the post on screen for 1 second; client sends event, server saves PostView (v2.9).
- **ARC-032** — Extending a pin does not re-pin for users who already saw it (v2.9).
- **ARC-033** — One PostView covers feed and dashboard (v2.9).
- **ARC-037** — Duplicate 2.9 renumbered to 2.10.
- **ARC-038** — §5.3/§5.4 wording now mentions the pin switch (v2.10).
- **ARC-039** — Flow C includes the pin switch (v2.10).
- **ARC-040** — Only pinned posts send a notification; unpinned = normal post (v2.10).

---

## Review history

- **2026-11-13 · Review #1** — Full review of PRD v2.6. No code. 13 known PRD issues confirmed open; 15 new (ARC-014–028). Top risks: PRD not in git, Gemini terms vs minors, .gitignore.
- **2026-11-13 · Review #2** — PRD v2.7 (author info on posts, public profile, section-only ranks). ARC-003 fixed; ARC-014 partly fixed; ARC-029, ARC-030 new.
- **2026-11-14 · Review #3** — PRD v2.8 (seen-once pins, pin_section_id, PostView). ARC-001 fixed; ARC-031–033 new.
- **2026-11-14 · Review #4** — (details lost; ARC-034–036 were likely logged here, together with the routine / ClassMeetingOffering change.)
- **2026-11-14 · Review #5** — PRD v2.9 (seen rule, extend, pin switch). ARC-023, 031, 032, 033 fixed; ARC-037–040 new, all fixed in v2.10 (commit 05c7cb0).
- **2026-11-14 · Log rebuilt** — file was found empty; rebuilt from review reports. ARC-006 marked partly fixed after checking PRD v2.10 §6.
- **2026-11-14 · Review #6** — PRD v2.11 (Gemini → Groq). ARC-017 fixed pending client confirmation. No conflicts with §9, §10, out-of-scope, or other sections. ARC-005 still open (Settings entity needed for AI provider/model config and daily limits).
- **2026-11-14 · Review #7** — Pre-commit review of .gitignore rewrite and PRD v2.12 (9 new entities). ARC-015 fixed (proper .gitignore with .env.example, .claude/ committed except settings.local.json). ARC-005 mostly fixed (all 9 entities map correctly to features 5.3.1, 5.7.3, 5.8, 5.12, 5.13, 5.18, 5.20). .claude/ directory safe to commit (no secrets, no personal info). Ready to commit.
- **2026-11-14 · Review #8** — PRD v2.13 and v2.14 uncommitted changes. v2.13 (developer): client confirmed all students 18+, exam scoring rules (multi-correct all-or-nothing, best attempt counts), privacy Admin+student only, Holiday entity, attendance "Not taken"/"N/A", Groq confirmed. v2.14 (user): Admin adds students from session page with Student ID+password, max 30 active students per section (blocks add/move/CSV when full), Enrollment with id/status/dates for every student, section_id on ExamAttempt and AttendanceRecord, section move ends old enrollments. **Fixed:** ARC-007, 009, 011, 017, 018, 019, 020. **New:** ARC-041 (HSC age claim conflicts with typical ages 16-18; client-confirmed but unusual, possibly adult education program). No conflicts with §2.4, §4.4, §5.15, §5.18. Section capacity examples changed from 50 to 30. Ready to commit.
