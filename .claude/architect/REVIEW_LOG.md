# Architect Review Log — College Management System

> Rebuilt on 2026-11-14 from the architect's review reports (the original file was found empty).
> ARC-034 to ARC-036 could not be recovered; they were logged during a review whose report did not list them.

## Issue summary

| ID      | Title                                        | Severity | Location                          | First seen | Status                        |
| ------- | -------------------------------------------- | -------- | --------------------------------- | ---------- | ----------------------------- |
| ARC-001 | Pin audience by group, should be section     | High     | PRD §6 Post                       | 2026-11-13 | Fixed (v2.8)                  |
| ARC-002 | Admin attendance: view-only vs edit          | Medium   | PRD §2.1 vs §5.18.3               | 2026-11-13 | Fixed (v2.16)                 |
| ARC-003 | Group rank cannot be computed                | High     | PRD §5.15                         | 2026-11-13 | Fixed (v2.7)                  |
| ARC-004 | Phase contradictions                         | Medium   | PRD §5.2, §5.9, §5.10, §5.20, §10 | 2026-11-13 | Fixed (v2.16)                 |
| ARC-005 | Missing entities in data model               | High     | PRD §6                            | 2026-11-13 | Mostly fixed (v2.12)          |
| ARC-006 | ClassMeeting courses stored as array         | High     | PRD §6                            | 2026-11-13 | Fixed (v2.19)                 |
| ARC-007 | Exam scoring gaps                            | High     | PRD §5.14                         | 2026-11-13 | Fixed (v2.13)                 |
| ARC-008 | Class 11/12 stored in two places             | Medium   | PRD §6 StudentProfile             | 2026-11-13 | Open                          |
| ARC-009 | Enrollment meaning is contradictory          | Medium   | PRD §2.4 vs §6                    | 2026-11-13 | Fixed (v2.14)                 |
| ARC-010 | Section Mentor scope unclear                 | Medium   | PRD §2.1                          | 2026-11-13 | Open                          |
| ARC-011 | Child safety in 1-to-1 messaging             | High     | PRD §5.8                          | 2026-11-13 | Closed (client-decided, v2.17) |
| ARC-012 | Decision #13 cites numbers that don't exist  | Low      | PRD §11                           | 2026-11-13 | Fixed (v2.15)                 |
| ARC-013 | Repo hygiene                                 | Medium   | repo root                         | 2026-11-13 | Open                          |
| ARC-014 | PRD not in git                               | Critical | commit 6482bc2                    | 2026-11-13 | Fixed (f566d54)               |
| ARC-015 | .gitignore wrong both ways                   | High     | .gitignore                        | 2026-11-13 | Fixed (v2.12)                 |
| ARC-016 | Misleading commit message                    | Low      | commit 6482bc2                    | 2026-11-13 | Fixed (v2.15)                 |
| ARC-017 | Gemini API terms forbid under-18 users       | Critical | PRD §5.20, Decision #9            | 2026-11-13 | Fixed (v2.13, Groq confirmed) |
| ARC-018 | Privacy rule contradicts itself              | High     | PRD §8 vs §5.3.1                  | 2026-11-13 | Fixed (v2.13)                 |
| ARC-019 | Attendance calendar & calculation gaps       | High     | PRD §5.18                         | 2026-11-13 | Fixed (v2.13)                 |
| ARC-020 | Section move loses history                   | High     | PRD §4.4, §5.3, §6                | 2026-11-13 | Fixed (v2.14)                 |
| ARC-021 | Correct answers leak during exam window      | High     | PRD §5.14.1                       | 2026-11-13 | Fixed (v2.16)                 |
| ARC-022 | Exam window vs duration; live bank questions | Medium   | PRD §5.14, §6                     | 2026-11-13 | Fixed (v2.16)                 |
| ARC-023 | Every Admin/Mentor post auto-pins            | Medium   | PRD §5.7.2                        | 2026-11-13 | Fixed (v2.9)                  |
| ARC-024 | Timezone never stated                        | Medium   | PRD §8                            | 2026-11-13 | Fixed (v2.16)                 |
| ARC-025 | SMTP daily limits                            | Medium   | PRD §5.9                          | 2026-11-13 | Fixed (v2.16)                 |
| ARC-026 | Single Admin, no recovery                    | Low      | PRD §2                            | 2026-11-13 | Closed (by design)            |
| ARC-027 | No Period/Room entities                      | Low      | PRD §6                            | 2026-11-13 | Fixed (v2.16)                 |
| ARC-028 | Public repo contains client PRD              | Medium   | GitHub                            | 2026-11-13 | Open (client)                 |
| ARC-029 | Public profile of inactive users undefined   | Low      | PRD §5.7.1 vs §4.4                | 2026-11-13 | Fixed (v2.15)                 |
| ARC-030 | Student ID on public profile                 | Low      | PRD §5.7.1                        | 2026-11-13 | Fixed (v2.15)                 |
| ARC-031 | "Seen" definition vague                      | Medium   | PRD §5.7.2                        | 2026-11-14 | Fixed (v2.9)                  |
| ARC-032 | Extend pin vs already seen                   | Medium   | PRD §5.7.2                        | 2026-11-14 | Fixed (v2.9)                  |
| ARC-033 | Dashboard vs feed seen tracking              | Low      | PRD §5.2.3 vs §5.7.2              | 2026-11-14 | Fixed (v2.9)                  |
| ARC-037 | Duplicate version 2.9                        | Low      | PRD revision history              | 2026-11-14 | Fixed (v2.10)                 |
| ARC-038 | Stale pin wording in §5.3 / §5.4             | Low      | PRD §5.3, §5.4                    | 2026-11-14 | Fixed (v2.10)                 |
| ARC-039 | Flow C missing pin switch                    | Low      | PRD §7                            | 2026-11-14 | Fixed (v2.10)                 |
| ARC-040 | Unpinned Admin/Mentor posts: notification?   | Medium   | PRD §5.10                         | 2026-11-14 | Fixed (v2.10)                 |
| ARC-041 | HSC age claim conflicts with typical ages   | Medium   | PRD §1                            | 2026-11-14 | Closed (client-decided, v2.16) |
| ARC-042 | Period/Room deletion cascade undefined       | Low      | PRD §5.17.1, §6                   | 2026-11-14 | Fixed (v2.16)                 |
| ARC-043 | SpecialDay interaction with routine unclear  | Medium   | PRD §5.17.1, §6 SpecialDay        | 2026-11-14 | Fixed (v2.16)                 |
| ARC-044 | ExamQuestion snapshot vs exam editing        | Medium   | PRD §5.14.1, §6 ExamQuestion      | 2026-11-14 | Fixed (v2.16)                 |
| ARC-045 | ClassMeeting.period_id nullability unclear   | Low      | PRD §6 ClassMeeting               | 2026-11-14 | Open                              |
| ARC-046 | AttendanceEdit scope ambiguous               | Low      | PRD §5.18.3, §6 AttendanceEdit    | 2026-11-14 | Open                              |
| ARC-047 | SpecialDay periods_json format undefined     | Low      | PRD §6 SpecialDay                 | 2026-11-14 | Fixed (v2.16)                 |
| ARC-048 | Google SMTP rate limit enforcement           | Low      | PRD §5.9                          | 2026-11-14 | Open                              |
| ARC-049 | ExamQuestion.question_id missing from schema | Medium   | PRD §6 ExamQuestion               | 2026-11-14 | Fixed (v2.16)                 |
| ARC-050 | Online class and extra class field rules     | Low      | PRD §6 ClassMeeting               | 2026-11-14 | Open                              |
| ARC-051 | Minors: no consent/privacy rule for chat, AI | Medium   | PRD §1 header, §5.10, §5.19, §3.1 | 2026-11-14 | NEW                               |
| ARC-052 | DOB self-editable; age use and limit vague   | Low      | PRD §3.1, §5.6, §6 StudentProfile | 2026-11-14 | NEW                               |
| ARC-053 | Room availability check scope undefined     | Low      | PRD §5.17.1, §6 ClassMeeting      | 2026-11-14 | Fixed (v2.18)                     |
| ARC-054 | UNIQUE(routine_slot_id,date) blocks re-create after cancel | Low | PRD §6 ClassMeeting | 2026-11-14 | NEW |

---

## Issue details

### 🔴 Critical

**ARC-017 — Gemini API terms forbid under-18 users** · PRD §5.20, §9, Decision #9 · Fixed (v2.17)

- **Problem:** The Gemini API Additional Terms say users must be 18 or older, and the API must not be used in an app "directed towards or likely to be accessed by" people under 18. HSC Class 11–12 students are mostly 16–18.
- **Fix applied in v2.11:** Switched to Groq free tier. Groq does not train on inputs, and its terms allow apps used by minors (college responsible).
- **Client confirmation in v2.13:** Client confirmed all students are 18+, so Groq stays. Open question 1 removed from §11. See ARC-041 for age claim verification.
- **Client correction in v2.17:** Students are up to 18 years old and may be minors. Gemini stays rejected; Groq stays because its terms allow minors (college responsible). PRD §5.20 and Decision #9/#17 reworded.

**ARC-014 — PRD not in git** · commit 6482bc2 · Fixed (f566d54)

- **Problem:** Commit 6482bc2 deleted `PRD.md` from the root; the only copy was in the git-ignored `.claude/` folder.
- **Fix applied:** PRD.md restored to the root and committed. Versions 2.7–2.10 are committed too.

### 🟠 High

**ARC-005 — Missing entities in data model** · PRD §6 · Mostly fixed (v2.13)

- **Problem:** Many features in §5 require entities not listed in §6: configurable settings (attendance threshold, grading scale, AI provider/model/limits, pin length), activity tracking (login history, AI usage per student per day), moderation (warn/mute sanctions, banned words), messaging (block list), audit trail (Admin actions), recording and material view counts.
- **Fixed in v2.12:** Added Settings, AIUsage, AuditLog, LoginHistory, UserSanction, Block, BannedWord, RecordingProgress, MaterialView.
- **Fixed in v2.13:** Added Holiday entity.
- **Still missing:** Period/Room (ARC-027, low priority).

**ARC-007 — Exam scoring gaps** · PRD §5.14 · Fixed (v2.13)

- **Problem:** No rule for: partial marks on multi-correct MCQs; how negative marking works with multi-correct; which attempt counts (best, last or first) when a quiz allows several attempts.
- **Fix applied in v2.13:** Single-correct: full marks if correct, negative marks if set, 0 if unanswered. Multi-correct: all-or-nothing (full marks only if exactly all correct options selected and no wrong ones), no negative marks. Student total never goes below 0. Quizzes with multiple attempts: best attempt counts for progress and rank.

**ARC-011 — Child safety in 1-to-1 messaging** · PRD §5.8 · Closed (client-decided, v2.17)

- **Problem:** Students and teachers can message minors 1-to-1 freely, and the Admin can only see chats that someone reports.
- **Fix applied in v2.13:** Client confirmed all students are 18 or older; no minors on the portal. §5.8 now states "All users are adults (18+), so 1-to-1 chat is open to everyone as listed above; no extra minor-protection rules are needed." Block/report available from every chat. See ARC-041 for age claim verification.
- **Client correction in v2.17:** Students may be under 18. The client kept 1-to-1 chat open to everyone; §5.8 now says so, relying on block/report, banned-word filter and Admin warn/mute. No extra age-based chat rules are built. Residual risk accepted by the client.

**ARC-018 — Privacy rule contradicts itself** · PRD §8 vs §5.3.1 · Fixed (v2.13)

- **Problem:** §8 said mobile, address and guardian info are visible to "their teachers"; §5.3.1 said teachers see only profile and course data.
- **Fix applied in v2.13:** §8 now says "Students' personal details (mobile, address, guardian info, DOB) visible **only to the student and the Admin**. Teachers and Section Mentors see only profile and course data (Section 5.3.1)."

**ARC-019 — Attendance calendar and calculation gaps** · PRD §5.18 · Fixed (v2.13)

- **Problem:** No Holiday entity, so the routine generates meetings on holidays. "Classes held" not defined for meetings where nobody took attendance. Held − Excused = 0 divides by zero.
- **Fix applied in v2.13:** Holiday entity added (id, start_date, end_date, title, created_by). §5.17 says Admin marks holidays; no Class Meetings generated on those days; future meetings on new holiday dates (with no attendance) are removed. §5.18.4: "Classes held" = meetings where attendance was taken; a meeting with no attendance taken is not counted and shows as "Not taken" to teacher/Section Mentor/Admin. If Classes held − Excused = 0, the percentage shows "N/A".

**ARC-020 — Moving section or class loses history** · PRD §4.4, §5.3, §6 · Fixed (v2.14)

- **Problem:** Enrollment had no start/end date or status, and AttendanceRecord / ExamAttempt did not store which section the student was in.
- **Fix applied in v2.14:** Enrollment now `(id, course_offering_id, student_id, status (active/ended), enrolled_at, ended_at)` with "a row for **every** student in every offering they take; ending keeps history; only one active row per student + offering." AttendanceRecord and ExamAttempt now store `section_id` (section at the time of the record). §4.4 says moving a student ends old enrollments and creates new ones; past attendance, exam attempts and ranks stay with the section the student was in at that time.

**ARC-021 — Correct answers leak during the exam window** · PRD §5.14.1 · Fixed (v2.16)

- **Problem:** "Show correct answers after submission" lets the first student who submits see the answers and share them while others are still taking the exam.
- **Fix applied in v2.16:** §5.14.1 now says "Correct answers are shown only after the exam window has ended (`end_at` passed), never right after one student submits, so answers cannot be shared while others are still taking the exam."

**ARC-041 — HSC age claim conflicts with typical ages** · PRD §1 · Closed (client-decided, v2.17)

- **Problem:** v2.13 says "all students are 18 or older (confirmed by the client)" but HSC Class 11-12 students are typically ages 16-17 in Bangladesh. Class 11 starts after SSC (age ~16), Class 12 ends at ~17-18.
- **Why it matters:** This is either (1) an adult HSC program (distance learning, second-chance education), or (2) a factual error. If it is a standard HSC college, the age claim is false, and the Groq/privacy decisions based on it are invalid.
- **Client correction in v2.17:** The client now says students are up to 18 and may be minors. PRD §1 and Decision #17 updated; age is calculated from the DOB in the profile, which the student keeps updated when editing the profile. Groq stays (terms allow minors). No age checks or blocks are built.
- **Earlier client decision in v2.16:** §1 clarifies "Where an age is needed, it is calculated from the date of birth in the student's profile; no age checks or blocks are built." The client has confirmed all students are 18+, so the portal is built on that assumption with no enforcement. If this is later found to be incorrect, privacy rules and AI provider terms must be reviewed.

### 🟡 Medium

**ARC-002 — Admin attendance: view-only vs edit** · PRD §2.1 vs §5.18.3 · Fixed (v2.16)

- **Problem:** The permission matrix says Admin can "View all" attendance; §5.18.3 says Admin "can edit any record".
- **Fix applied in v2.16:** Permission matrix updated to "✅ (view all, edit any; every edit logged)". AttendanceEdit table already in §6.

**ARC-004 — Phase contradictions** · PRD §5.2, §5.9, §5.10, §5.20, §10 · Fixed (v2.16)

- **Problem:** Browser push is Phase 2 in §5.10 but Phase 3 in §10. AI grounded in notes is Phase 2 in §5.20 but Phase 3 in §10. Notice emails for Important/Urgent are in a Phase 1 feature (§5.9), but "email notifications" are Phase 3. Phase 1 dashboards show attendance/exams that only arrive in Phase 2.
- **Fix applied in v2.16:** §10 now says "Section 10 is the single source for phases. If another section mentions a phase, this table wins. In Phase 1 the dashboards hide the widgets (attendance, exams, results) for features that are not built yet." Browser push → Phase 3 in §5.10. AI grounded in notes → Phase 3 in §5.20. Email sending clarified as Phase 3 in §5.9 with a note "(from Phase 3, Section 10)".

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

**ARC-022 — Exam window vs duration; live bank questions** · PRD §5.14, §6 · Fixed (v2.16)

- **Problem:** A student who starts at 9:50 in an 8–10 PM window with a 40-minute exam: the PRD does not say if time is cut at 10:00. Also, ExamQuestion points to live question-bank rows, so editing a bank question changes past exams.
- **Fix applied in v2.16:** §5.14.1 now says "a student's exam ends at the earlier of (start time + duration) and the window end. Example: window 8–10 PM, 40-minute exam, student starts at 9:50 → the exam auto-submits at 10:00." §6 ExamQuestion changed to "exam_id, order, marks, question_text, options_json, correct_json (snapshot copied from the question bank when the exam is published; source question_id kept for reference only)". §5.14.1: "Question snapshot: when an exam is published, the question text, options and correct answer are copied into the exam. Later edits to the teacher's question bank do not change published or past exams."

**ARC-024 — Timezone never stated** · PRD §8 · Fixed (v2.16)

- **Problem:** Routine, exams, attendance and pin expiry all depend on time, but the timezone is not written anywhere.
- **Fix applied in v2.16:** §8 now says "Timezone: All times are shown in Asia/Dhaka and stored in UTC (routine, exams, attendance, pin expiry, holidays)."

**ARC-025 — SMTP daily limits** · PRD §5.9 · Fixed (v2.16)

- **Problem:** Important/Urgent notice emails to ~3,000 users may hit SMTP daily limits (a personal Gmail is about 500/day).
- **Fix applied in v2.16:** §5.9 now says "Email sending: SMTP through a free Google account (no paid service). Emails go through a queue with rate limiting that stays under Google's daily sending limit (about 500/day for a personal Gmail; the Admin sets the limit in Settings). If more emails are waiting than the limit allows, the rest are sent the next day; in-app notifications are never delayed. Password-reset and verification emails go first."

**ARC-028 — Public repo contains client PRD** · GitHub · Open (client)

- **Problem:** The GitHub repo is PUBLIC and its history contains the client's PRD v1.0 (and now v2.7–2.10).
- **Fix:** Ask the client. If not OK, make the repo private.

### 🔵 Low

**ARC-012 — Decision #13 cites numbers that don't exist** · PRD §11 · Fixed (v2.15)

- **Problem:** "Requirement numbers 14, 15, 16 and 23 were removed" — the PRD has no numbered requirements, so this confuses any future reader.
- **Fix applied in v2.15:** Decision #13 reworded to "Some items in the client's original requirements list were removed by the client on purpose. No features are missing."

**ARC-016 — Misleading commit message** · commit 6482bc2 · Fixed (v2.15)

- **Problem:** "add .gitignore and create nothing.txt file" hid the deletion of the PRD.
- **Fix applied in v2.15:** Added commit rule to .claude/CLAUDE.md: "one topic per commit, and the message must describe everything the commit does (including any file deletions)."

**ARC-026 — Single Admin, no recovery** · PRD §2 · Closed (by design)

- **Problem:** Only one Admin account, with no second Admin or recovery path if the email is lost.
- **Client decision:** Single Admin by design. §2.2 now states "There is only one Admin account by design (client decision); no second Admin and no other recovery path. The Admin keeps the login email safe." Added as Decision #20.

**ARC-027 — No Period/Room entities** · PRD §6 · Fixed (v2.16)

- **Problem:** The routine grid needs period numbers and times per college, and possibly rooms, but there are no entities for them.
- **v2.15 client decision:** Admin types period times and room (free text) on each RoutineSlot. No separate Period/Room tables.
- **Fix applied in v2.16 (design change):** Admin Schedule Manager (§5.17.1) added with full Period and Room tables. §6 now has "Period: id, name, start_time, end_time" and "Room: id, name, capacity (optional), building (optional)". RoutineSlot changed from "day, start_time, end_time, room (free text)" to "day, period_id, room_id". Decision #21 updated to reflect the new design.

**ARC-029 — Public profile of inactive users undefined** · PRD §5.7.1 vs §4.4 · Fixed (v2.15)

- **Problem:** Posts by passed-out or deactivated students stay visible, but the PRD does not say what their public profile shows.
- **Fix applied in v2.15:** §5.7.1 now says "For a passed-out or deactivated user, the public profile shows only photo, name and the note 'This account is no longer active.' Nothing else (no session/section, bio or posts list). A permanently deleted user appears as 'Deleted user' with no profile (4.4)."

**ARC-030 — Student ID on public profile** · PRD §5.7.1 · Fixed (v2.15)

- **Problem:** Student ID + name + session + section on the public profile lets anyone identify a student outside the platform.
- **Note:** v2.13 confirmed all users are 18+, so this is no longer a child-protection issue, but the Student ID is the login ID and should not be public.
- **Fix applied in v2.15:** §5.7.1 now says the public profile "does not show the Student ID (the Student ID is the login ID; only the student, their teachers and the Admin see it)." Added as Decision #22.

**ARC-045 — ClassMeeting.period_id nullability unclear** · PRD §6 ClassMeeting · Open

- **Problem:** §6 ClassMeeting has "period_id, room_id, start_time, end_time (copied from the period when created, so later period changes do not alter past meetings)". But (a) if start_time and end_time are frozen copies, why keep period_id? (b) if period_id references a period that is later deleted, what happens? (c) for an "extra class" (routine_slot_id null), can period_id also be null if the Admin picks custom times?
- **Fix:** Clarify: period_id is kept for reporting/display (e.g. "Period 3" on the attendance sheet) even though the times are frozen. period_id can be null for extra classes with custom times. If a period is deleted, past ClassMeeting rows keep the period_id (it becomes a dangling reference, or Period has a soft-delete flag).

**ARC-046 — AttendanceEdit scope ambiguous** · PRD §5.18.3, §6 AttendanceEdit · Open

- **Problem:** §6 has AttendanceEdit (id, attendance_record_id, old_status, new_status, edited_by, edited_at). §2.1 says "Admin can edit any attendance record (logged)" but the permission matrix says teachers/mentors can "manage" attendance. Can teachers edit attendance they already marked? Are those edits also logged in AttendanceEdit, or only Admin edits?
- **Fix:** Clarify in §5.18.3: teachers and Section Mentors can edit attendance they marked (e.g. to fix a mistake), and every edit (by anyone) is saved in AttendanceEdit.

**ARC-048 — Google SMTP rate limit enforcement** · PRD §5.9 · Open

- **Problem:** §5.9 says "the Admin sets the limit in Settings" but does not say if the system enforces a hard cap (e.g. 500/day for Gmail) or allows the Admin to set any value. If the Admin sets 1000/day but Gmail allows only 500, emails will bounce after 500.
- **Fix:** Add a note: the system does not enforce a hard cap; the Admin is responsible for setting a correct limit. Or, if there is a safety rule, define it: "The system warns if the limit is set above 500 (typical Gmail free tier)."

**ARC-050 — Online class and extra class field rules** · PRD §6 ClassMeeting · Open

- **Problem:** ClassMeeting has period_id, room_id, but for an online class (online_class_id is set) these do not make sense. Also, for an extra class (routine_slot_id null), can the Admin pick a period (period_id + copied times) or type custom times (period_id null, manual times)?
- **Fix:** Add to §6: for an online class, period_id and room_id are null (or room_id = "Online"). For an extra class, the Admin can either pick an existing period (period_id is set, times copied) or leave period_id null and type custom start_time/end_time.

### ✅ Fixed (short)

- ARC-006 — ClassMeeting courses as array — join table (v2.10) + UNIQUE(routine_slot_id, date) — v2.19

- **ARC-001** — Pin audience now `pin_section_id` (null = everyone) + PostView entity (v2.8).
- **ARC-003** — Ranks are section-only; group rank removed (v2.7).
- **ARC-005** — 9 missing entities added (Settings, AIUsage, AuditLog, LoginHistory, UserSanction, Block, BannedWord, RecordingProgress, MaterialView) in v2.12; Holiday/Period/Room still missing but documented in other issues.
- **ARC-014** — PRD.md restored to root and committed (f566d54).
- **ARC-015** — .gitignore rewritten: removes `.claude` ignore (so agents/ and architect/ are committed), keeps .env ignored, adds .env.example, ignores only settings.local.json, plus proper ignores for node_modules/.next/dist/build/coverage/uploads/*.log (v2.12).
- **ARC-017** — AI switched from Gemini to Groq (allows minors, no training on data); Groq stays with students up to 18 / minors allowed (v2.17).
- **ARC-023** — "Pin this post" switch, on by default; pin audience fixed at creation (v2.9).
- **ARC-031** — Seen = at least half the post on screen for 1 second; client sends event, server saves PostView (v2.9).
- **ARC-032** — Extending a pin does not re-pin for users who already saw it (v2.9).
- **ARC-033** — One PostView covers feed and dashboard (v2.9).
- **ARC-037** — Duplicate 2.9 renumbered to 2.10.
- **ARC-038** — §5.3/§5.4 wording now mentions the pin switch (v2.10).
- **ARC-039** — Flow C includes the pin switch (v2.10).
- **ARC-040** — Only pinned posts send a notification; unpinned = normal post (v2.10).
- **ARC-012** — Decision #13 reworded from fake requirement numbers to "Some items in the client's original requirements list were removed" (v2.15).
- **ARC-016** — Commit rule added to .claude/CLAUDE.md (v2.15).
- **ARC-029** — Inactive user profile behavior defined (v2.15).
- **ARC-030** — Student ID removed from public profile; visible only to student, their teachers and Admin (v2.15).
- **ARC-002** — Permission matrix updated: Admin can edit any attendance (logged); AttendanceEdit in §6 (v2.16).
- **ARC-004** — §10 is single source for phases; browser push and AI notes → Phase 3; email → Phase 3; dashboards hide unbuilt widgets (v2.16).
- **ARC-021** — Correct answers shown only after exam end_at, not after one student submits (v2.16).
- **ARC-022** — Exam time = min(start + duration, window end); question snapshot in ExamQuestion (v2.16).
- **ARC-024** — Timezone Asia/Dhaka, stored in UTC (v2.16).
- **ARC-025** — Google SMTP with rate-limited queue; Admin sets daily limit in Settings (v2.16).
- **ARC-027** — Period and Room tables added with Admin Schedule Manager; RoutineSlot uses period_id, room_id (v2.16; reverses v2.15 design).
- **ARC-042** — Period/Room delete: Admin picks replacement or clears slots first (v2.16).
- **ARC-043** — SpecialDay rules for routine/holiday defined (v2.16).
- **ARC-044** — Exam question snapshot/edit rule defined (v2.16).
- **ARC-047** — SpecialDay periods_json format defined (v2.16).
- **ARC-049** — ExamQuestion.question_id added to schema (v2.16).

### 🔒 Closed by design

- **ARC-026** — Single Admin with no recovery path confirmed by client as acceptable risk; documented in §2.2 and Decision #20 (v2.15).
- **ARC-011** — Students may be minors; client keeps 1-to-1 chat open, no extra age rules (v2.17).
- **ARC-041** — Client says students are up to 18 (may be minors); age from profile DOB, no checks built; Groq allows minors (v2.17).

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
- **2026-11-14 · Review #9** — Pre-commit review of PRD v2.15 and .claude/CLAUDE.md update. **Fixed:** ARC-012 (Decision #13 reworded, no fake requirement numbers), ARC-016 (commit rule added to CLAUDE.md), ARC-029 (inactive user profile behavior defined in §5.7.1), ARC-030 (Student ID removed from public profile, visible only to student/teachers/Admin). **Closed by design:** ARC-026 (single Admin confirmed by client, §2.2 + Decision #20), ARC-027 (no Period/Room tables, Admin types times/room on RoutineSlot, §5.17 + §6 + Decision #21). All changes consistent with rest of PRD. RoutineSlot has structured start_time/end_time fields (for conflict detection) and free-text room. No new issues introduced. Ready to commit.
- **2026-11-14 · Review #10** — PRD v2.16 uncommitted changes. **Major additions:** Admin Schedule Manager (§5.17.1) with Period/Room tables (reverses v2.15 design), SpecialDay entity for whole-day changes, simplified exam scoring (right = marks, wrong = 0, no negative/partial), correct answers only after exam end_at, exam time capped at window end, question snapshot in ExamQuestion, Admin can edit any attendance (logged), Asia/Dhaka timezone, Google SMTP with rate-limited queue, §10 as single source for phases. **Fixed:** ARC-002, 004, 021, 022, 024, 025, 027 (7 issues). **Closed:** ARC-041 (client-decided: all students 18+, age from DOB, no checks). **New:** ARC-042 (Period/Room deletion cascade), ARC-043 (SpecialDay interaction with routine), ARC-044 (exam editing after publish), ARC-045 (ClassMeeting.period_id nullability), ARC-046 (AttendanceEdit scope), ARC-047 (SpecialDay periods_json format), ARC-048 (SMTP rate limit enforcement), ARC-049 (ExamQuestion.question_id missing from schema), ARC-050 (online/extra class field rules). All new issues are low/medium clarifications; no critical problems. The Admin Schedule Manager is well-designed. Ready to commit.

- **2026-11-14 · Review #11** — PRD v2.16 (re-check, no new PRD change; only system-architect.md changed). **Fixed:** ARC-042, 043, 044, 047, 049 (details moved to Fixed (short)). **Still open (Low, re-checked):** ARC-045, 046, 048, 050. **New:** 0. Log cleaned: detail blocks synced with table, history format fixed.
- **2026-11-14 · Review #12** — PRD v2.17 (age rule corrected: students up to 18, may be minors; Groq stays; chat stays open). No leftover 18+/adult wording outside history rows (v2.13 row is history). ARC-014 untouched. **Fixed:** 0. **New:** ARC-051 (Medium), ARC-052 (Low). **Open:** ARC-045, 046, 048, 050.
- **2026-11-14 · Review #13** — PRD v2.18 (Schedule Manager row in 5.3, calendar view and room warning in 5.17.1). Fixed: 0. New: ARC-053 (Low, fixed in v2.18). Open: ARC-045, 046, 048, 050, 051, 052.
- **2026-11-14 · Review #14** — PRD v2.19 (PRD.md, REVIEW_LOG.md). Fixed: ARC-006 (closed). New: ARC-054 (Low). Open: ARC-045, 046, 048, 050, 051, 052. Note: NULL routine_slot_id (extra class) stays allowed; unique is fine for Postgres/MySQL.
