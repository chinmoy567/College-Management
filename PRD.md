# Product Requirements Document (PRD)
## College Management System (CMS)

| Item | Detail |
|---|---|
| **Document Version** | 2.25 |
| **Date** | 14 November 2026 |
| **Product Type** | Web-based College Management, Learning & Student Community Portal |
| **Target Institution** | Higher Secondary College (Class 11 & 12 – HSC); **students are up to 18 years old (some may be under 18)**, as stated by the client |
| **User Roles** | Admin, Teacher (Course Teacher and/or Section Mentor), Student |

### Revision History
| Version | Date | Changes |
|---|---|---|
| 1.0 | 13 Nov 2026 | Initial PRD: accounts, sessions/groups, community feed, messaging, routine, class links, book PDFs. |
| 2.0 | 13 Nov 2026 | Added sections & course-teacher assignment, pinned Admin/Coordinator posts, separate dashboards, online classes, recorded classes, online exams & quizzes, exam progress, previous-year questions, notices (central & class-wise), notifications, book shop, AI chatbox, attendance (placeholder). |
| 2.1 | 13 Nov 2026 | Full per-period attendance design (5.18) and Admin "Student 360°" one-click student view (5.3.1). |
| 2.2 | 13 Nov 2026 | Client answers applied: book shop is digital PDF only with a placeholder **Pay** button (no payment gateway); live classes via free external links (Google Meet / Jitsi); recorded classes are teacher-made YouTube links only; AI chatbox on the free Google Gemini API tier; exam ranks always shown to students. |
| 2.3 | 13 Nov 2026 | Sessions closed manually by Admin only; exams are MCQ-only with automatic grading; all open questions resolved. |
| 2.4 | 13 Nov 2026 | Attendance is mainly taken by teachers in the physical classroom (select session, group, section, course); Admin allocates the routine for every session. |
| 2.5 | 13 Nov 2026 | Routine is created and changed by the Admin only; Batch Coordinators can only view it. |
| 2.6 | 13 Nov 2026 | "Batch Coordinator" renamed **Section Mentor**; one Section Mentor per section (not per group); substitutes and class cancellations decided by the Admin only. |
| 2.7 | 13 Nov 2026 | Every post shows the author's session, group and section; any logged-in user can open the author's public profile. Exam ranks are **section-only** (exams are created by the course teacher for one section); group rank removed. |
| 2.8 | 14 Nov 2026 | Pinned posts are **seen-once**: an Admin/Section Mentor post stays at the top for each user only until that user has seen it once, for at most 7 days. Mentor pins target one section (`pin_section_id`). Added PostView entity. |
| 2.9 | 14 Nov 2026 | Defined "seen" (at least half of the post on screen for 1 second); one seen record covers feed and dashboard; extending a pin does not re-pin for users who already saw it; Admin/Mentor get a **Pin this post** switch (on by default). |
| 2.10 | 14 Nov 2026 | Routine changes apply to future classes only; the Admin is responsible for a correct, conflict-free routine. Class Meeting courses moved to a ClassMeetingOffering table (no duplicates). |
| 2.11 | 14 Nov 2026 | AI chatbox moved from Google Gemini to the **Groq** free tier: Gemini's API terms do not allow apps used by under-18s; Groq's terms allow them (the college is responsible) and Groq does not train on inputs. Client confirmation added as an open question. |
| 2.12 | 14 Nov 2026 | Data model: added Settings, AIUsage, AuditLog, LoginHistory, UserSanction (warn/mute), Block, BannedWord, RecordingProgress and MaterialView. |
| 2.13 | 14 Nov 2026 | Client confirmed **all students are 18+** (no minors); Groq stays as the AI provider. Exam scoring rules (multi-correct all-or-nothing, best quiz attempt counts). Private details visible only to the student and the Admin. Admin manages the academic calendar (holidays); attendance rules for "not taken" meetings and "N/A". Added Holiday entity. |
| 2.14 | 14 Nov 2026 | Adding students: Admin adds students from the session page (system gives a Student ID + password) and can create sections there. **Each section holds at most 30 students**; when full, the Admin creates another section. Enrollment keeps history (status, dates), and attendance/exam records store the student's section, so moving a student keeps old data correct. |
| 2.15 | 14 Nov 2026 | Single Admin confirmed by design (no second Admin). Routine period times and rooms are typed by the Admin on each routine slot (no Period/Room tables). Public profile of passed-out/deactivated users defined. Student ID removed from the public profile. Decision #13 reworded. |
| 2.16 | 14 Nov 2026 | **Admin Schedule Manager** (5.17.1): Admin adds/edits/deletes periods, rooms, routine slots, holidays and any single day or class; Period and Room tables added (replaces the v2.15 free-text rule). Exam scoring simplified: right = marks, wrong/unanswered = 0, no negative marking, no partial marks. Correct answers shown only after the exam window ends; exam time capped at window end; question snapshot at publish. Admin can edit any attendance record (logged). Timezone Asia/Dhaka. SMTP via free Google account with a rate-limited queue. Phases: §10 is the single source. Student age comes from profile DOB. |
| 2.17 | 14 Nov 2026 | Client corrected the age rule: students are **up to 18 years old and may be minors** (replaces the v2.13 "18+" statement). **Groq** stays as the AI provider (its terms allow apps used by minors; the college is responsible). Student age comes from the **date of birth in the profile**, and a student who edits the profile also updates the DOB. 1-to-1 chat stays open as listed, with block/report from every chat. |
| 2.18 | 14 Nov 2026 | Client request: the Admin updates the routine, schedule, classrooms and holidays from one portal. Added the **Schedule Manager** to the Admin Panel table (5.3), a **calendar view** with inline add/edit/delete, and a room-availability warning (5.17.1). |
| 2.19 | 14 Nov 2026 | Added UNIQUE(routine_slot_id, date) on ClassMeeting (closes ARC-006). |
| 2.20 | 14 Nov 2026 | Exam duration is chosen from fixed presets; the server enforces the exam deadline (§5.14.1). |
| 2.21 | 14 Nov 2026 | Class 11 → 12 is a manual Admin move into a Class 12 section; Section now has a class (§4.4, §6). |
| 2.22 | 14 Nov 2026 | Logins use server-side sessions in PostgreSQL (instantly revocable); no Redis (§4.6, §6, §9). |
| 2.23 | 14 Nov 2026 | Pre-development review: exam examples use a preset (45 min); one in-progress attempt per student; exam clock keeps running while offline; correct answers never sent to the browser before the window ends; attendance % counted per student; an online class in a routine period uses the existing Class Meeting; Class Meetings generated 14 days ahead and Admin-deleted meetings are kept as `removed`; permanent delete anonymises the user and the AuditLog holds no personal data; banned words blocked in chat; message/user reports; upload limits; WebSocket session checks; PostgreSQL job queue. Data model: ExamQuestion id, ExamAttempt deadline/attempt number, Answer → ExamQuestion, OnlineClassOffering, ConversationMember read state, NoticeRead, Comment replies, unique keys; student class/session/group come from the section. Attendance moved to Phase 1; auth email in Phase 1. Every student has an email. |
| 2.24 | 14 Nov 2026 | Senior review fixes (kept simple): combined classes in the routine (RoutineSlotOffering); routine slots soft-deleted; a course-teacher change updates future meetings; one link between online class and meeting; Chapter table; shuffled order saved per attempt; teacher can fix a wrong answer key (regrade) and give one student extra time; email verification no longer blocks first login; overall course rank defined; ranks and per-question results only after the window ends; mute scope; AI chats private to the student; Admin two-step login; all uploads private; questions never sent before start; book preview as a separate file; attendance draft kept on the device; stack chosen (one Next.js app); Phase 1 build order. |
| 2.25 | 14 Nov 2026 | Removed Section 11 (Decisions & Open Questions); every decision is already written in its own section. |

---

## 1. Overview

### 1.1 Purpose
The College Management System is a web portal that lets a college manage academic sessions, groups, sections, courses, teachers and students in one place. On top of administration, it is a complete learning platform (live classes, recorded classes, notes, online exams, results, attendance) and a private, Facebook-style community where students can share problems, post, react, comment and message each other.

The **Admin** controls the academic structure and all accounts, and decides **which courses run in every session-group-section and who teaches them**. **Teachers** run their assigned courses: classes, notes, exams, notices and attendance. A teacher may also be a **Section Mentor** who guides **one section** (e.g. 2024–25 · Science · A). **Students** learn, take exams, follow their routine and take part in the community.

### 1.2 Goals
1. Centralize session, group, section, course, teacher and student management under one Admin.
2. Let the Admin assign courses and course teachers for every session → group → section.
3. Provide secure, role-based login with admin-issued credentials and email-based password reset.
4. Give each role (Admin, Teacher, Student) a **separate dashboard** showing only what matters to them.
5. Deliver learning online: live classes, free recorded classes, notes, previous-year questions and online exams/quizzes with progress tracking.
6. Build an internal social space (posts, reactions, comments, messaging) in which official Admin/Section Mentor posts are highlighted.
7. Keep everyone informed through central notices, class-wise notices and real-time notifications.
8. Sell digital (PDF) books through an online book shop.
9. Offer a free AI study assistant to students.
10. Remove students' access once the Admin closes their session (marks it Passed Out).

### 1.3 Scope
**In scope (this PRD):** everything listed in Section 5.
**Out of scope:** fee/tuition payment, any online payment gateway (this version), printed books and delivery, recording or hosting videos inside the portal, any paid third-party service (video, AI), HR & payroll, library circulation of physical library books, native mobile apps (the web app will be mobile-responsive).

### 1.4 Glossary
| Term | Meaning |
|---|---|
| **Session** | An academic batch, e.g. "2024–25". Its students start in Class 11 sections, are moved by the Admin into Class 12 sections of the same session (4.4), and finally the session is closed (Passed Out). |
| **Group** | Science, Commerce or Arts inside a session (auto-created). |
| **Section** | A division of a group, e.g. Science-A, Science-B. Created by the Admin. |
| **Course** | A subject from the college subject catalog, e.g. Physics 1st Paper. |
| **Course Offering** | One course taught to one section by one teacher, e.g. *2024–25 · Science · A · Physics 1st Paper · Mr. Rahman*. Most teaching features attach to a course offering. |
| **Section Mentor** | The teacher in charge of **one section**, assigned by the Admin. Every section has exactly one, e.g. Science A, B, C → 3 Section Mentors; Science, Arts and Commerce with 3 sections each → 9. |
| **Pinned post** | An Admin/Section Mentor post shown at the top of a user's feed until that user has seen it once, for at most 7 days. |

---

## 2. User Roles & Access

### 2.1 Permission Matrix
| Feature | Admin | Section Mentor | Course Teacher | Student |
|---|:-:|:-:|:-:|:-:|
| Login with ID/email + password | ✅ | ✅ | ✅ | ✅ |
| Create / edit sessions, groups, sections | ✅ | ❌ | ❌ | ❌ |
| Manage course catalog & assign course teachers | ✅ | ❌ | ❌ | ❌ |
| Add / edit / remove teacher & student accounts | ✅ | ❌ | ❌ | ❌ |
| Assign Section Mentor | ✅ | ❌ | ❌ | ❌ |
| Publish central (college-wide) notices | ✅ | ❌ | ❌ | ❌ |
| Publish class-wise notices | ✅ | ✅ (own section) | ✅ (own sections) | ❌ |
| Create / edit own posts | ✅ | ✅ | ✅ | ✅ |
| Pinned posts (until seen, max 7 days) | ✅ (everyone) | ✅ (own section) | ❌ | ❌ |
| Delete any post / comment (moderation) | ✅ | ❌ | ❌ | ❌ |
| React / comment on posts | ✅ | ✅ | ✅ | ✅ |
| Messaging (1-to-1) | ✅ | ✅ | ✅ | ✅ |
| Group chat of session-group | ❌ | ✅ (auto) | ❌ | ✅ (auto) |
| Section chat | ❌ | ✅ (auto) | ✅ (auto, own sections) | ✅ (auto) |
| Manage routine, periods, rooms, holidays & daily schedule (5.17.1) | ✅ | ❌ (view own section) | ❌ (view own) | View |
| Create / conduct online classes | ❌ | ✅ (own courses) | ✅ (own courses) | Attend |
| Add recorded class (YouTube) links | ✅ | ✅ (own section) | ✅ (own courses) | Watch |
| Upload notes & study materials | ✅ | ✅ (own section) | ✅ (own courses) | View / download |
| Create exams & quizzes | ❌ | ✅ (own courses only, as course teacher) | ✅ (own courses) | Take |
| View exam results / progress | ✅ (all) | ✅ (own section) | ✅ (own courses) | Own only |
| Upload previous-year questions | ✅ | ✅ | ✅ (own courses) | View |
| Take / manage attendance | ✅ (view all, edit any; every edit logged) | ✅ (own section) | ✅ (own courses) | View own |
| Manage book shop (catalog, purchases) | ✅ | ❌ | ❌ | Buy |
| AI chatbox | ❌ | ❌ | ❌ | ✅ |
| Assign which teacher takes which class, substitute teachers, cancel a class | ✅ | ❌ | ❌ | ❌ |
| Mark students as Passed Out | ✅ | ❌ | ❌ | ❌ |

> "Course Teacher" and "Section Mentor" are not separate account types. They are permissions a **Teacher** account gets through assignments. One teacher can teach several course offerings and also be the Section Mentor of a section. **Everything is decided by the Admin:** who teaches which class, who is the Section Mentor of each section, and the routine.

### 2.2 Admin
- Single super-user. Logs in with **email + password**. **There is only one Admin account by design** (client decision); no second Admin and no other recovery path. The Admin keeps the login email safe.
- First login uses a **seed password** set during deployment; the system forces a password change.
- **Two-step login:** the Admin turns on an authenticator app (TOTP, e.g. Google Authenticator) at first login and gets **10 one-time backup codes** to print and keep safe. Every Admin login asks for the password and a code.
- Can reset own password via email (the authenticator code or a backup code is still needed).

### 2.3 Teacher
- Account created by Admin with a **User ID and initial password**.
- Gains teaching rights only for course offerings the Admin assigns.
- Can be assigned by the Admin as the **Section Mentor** of a section.

### 2.4 Student
- Account created by Admin **inside a session → group → section** with a **Student ID and initial password**.
- Belongs to exactly one session, one group and one section at any time.
- Automatically enrolled in every course offering of their section.
- Cannot log in after being marked **Passed Out**.
- Students are **up to 18 years old and may be under 18** (stated by the client). Where an age is needed, it is calculated from the date of birth in the student's profile. When a student edits their profile, they also keep their **date of birth** up to date. No age checks or blocks are built.

---

## 3. Academic Structure & Course Assignment

### 3.1 Hierarchy
```
Session (2024–25)
 └── Group (Science | Commerce | Arts)          ← auto-created with the session
      └── Section (A, B, C …)                   ← created by Admin (default "A")
           └── Course Offering (Course + Teacher) ← assigned by Admin
                └── Students of the section are auto-enrolled
```

**How it works (example):**
1. The Admin creates as many sessions as needed, e.g. **2024–25**, **2025–26**, **2026–27**, **2027–28**.
2. When a session is created, its **3 groups (Science, Arts, Commerce) are created automatically**. Every session has its own separate 3 groups.
3. Inside each group, the Admin creates as many **sections** as needed. **A section holds at most 30 students.** When a section is full, the Admin creates another one; how many sections to create is the Admin's choice. Example: *2024–25 → Science* has 90 students, so the Admin creates 3 sections: **Science-A (30)**, **Science-B (30)**, **Science-C (30)**. Arts and Commerce of the same session can have a different number of sections.

```
2024–25
 ├── Science   → Section A (30) · Section B (30) · Section C (30)   = 90 students
 ├── Arts      → Section A (…)
 └── Commerce  → Section A (…) · Section B (…)
2025–26
 ├── Science   → its own sections
 ├── Arts      → its own sections
 └── Commerce  → its own sections
```

### 3.1.1 Adding Students (Admin)
1. Admin opens **Sessions → *2024–25*** and clicks **Add student**.
2. Admin selects the **group** and the **section**. If no section has a free place, the Admin can **create a new section right there** (e.g. Science-D).
3. Admin enters the student's details (name, roll, email; the class comes from the section). The system creates a unique **Student ID** (Admin can edit it) and an initial **password** (or the Admin types one; "Generate" creates a strong one).
4. The system shows a **credential slip** (ID + password) that the Admin prints or copies and gives to the student. The student must change the password on first login (4.2).
5. The student is **automatically enrolled** in every course offering of that section (optional courses: see 3.3 step 6).
- **30-student limit:** a section with 30 active students is **full**. The system blocks adding or moving more students into it and asks the Admin to pick or create another section. Passed-out, deactivated and deleted students do not count toward the 30.
- Bulk CSV import (4.4) follows the same rules: rows for a full section are rejected with a clear message, and nothing is half-imported.

### 3.2 Course Catalog
- Admin maintains a master list of **courses**: name, code, group (Science/Commerce/Arts/Common), class (11/12/both), paper (1st/2nd), type (compulsory/optional).
- Example: *Bangla 1st Paper (Common)*, *Physics 2nd Paper (Science)*, *Accounting 1st Paper (Commerce)*.

### 3.3 Assigning Courses & Course Teachers
1. Admin opens **Session → Group → Section**.
2. Clicks **Assign Courses**. The system suggests every catalog course that matches the group and class; Admin ticks the ones to offer.
3. For each selected course, Admin selects the **course teacher** from a dropdown (filtered by the teacher's subjects, but any teacher can be chosen).
4. **Copy assignments** shortcut: copy all course + teacher assignments from one section to another, or from the previous session.
5. Admin can change a course teacher at any time. All existing content (notes, exams, recordings) stays with the course offering; the new teacher takes it over. Future Class Meetings of that offering with no attendance yet get the new teacher; past meetings keep the old one.
6. Optional courses: Admin can choose which students of the section take an optional course (e.g. Higher Math vs Biology). The default is all students.

### 3.4 Effects of an Assignment
- The teacher sees the course offering on their dashboard under **My Courses**.
- The teacher is auto-added to the **section chat**.
- The teacher can now create classes, notes, exams, notices and attendance for that course offering.
- The course offering appears in the routine builder for that section.

---

## 4. Authentication & Account Lifecycle

### 4.1 Login Flow
1. User opens Landing Page → clicks **Login**.
2. Enters **User ID or Email** + **Password**; the system detects the role.
3. On success, the user is redirected to their **role-specific dashboard**.

### 4.2 First-Time Login (Teacher & Student)
1. Logs in with admin-given User ID and password.
2. Forced **"Complete Your Profile"** step: set a new password and mobile number. A verification link is sent to the email the Admin entered.
3. After this step the full dashboard is unlocked. **Email verification does not block the dashboard** (the daily email limit could delay it); a banner reminds the user until the email is verified. Password reset by email works only for a verified email; otherwise the Admin resets the password.

### 4.3 Password & Email Management
| Action | How it works |
|---|---|
| **Forgot password** | Enter registered email → reset link/OTP via SMTP → set new password. |
| **Change password** | From Profile, with current password. |
| **Change email** | Verification link sent to the new email → confirmed → updated. |
| **Admin reset** | Admin can edit any teacher/student ID or reset their password. |
| **Auto-generate password** | "Generate" button creates a strong random password. |

**SMTP:** configured via environment variables (host, port, user, password, sender). Credentials will be provided by the client.

### 4.4 Account Management by Admin
- **Add:** single form or **bulk CSV import** (students: name, roll, section, email; teachers: name, designation, subjects).
- **Edit:** name, ID, section (move student), designation, subjects, status.
- **Move student to another section:** only into a section with a free place (max 30). The old enrollments are **ended** (not deleted) and new ones are created for the new section's course offerings. Past attendance, exam attempts and ranks stay with the section the student was in at that time.
- **Promote Class 11 → 12 (manual, Admin only):** nothing moves automatically. The Admin creates the Class 12 sections (each section has a **class**, 11 or 12), assigns their courses, teachers, mentor and routine, then moves students into them, one by one, in bulk, or a whole section at once. Same rules as a section move: only into a section with a free place (max 30), old enrollments are **ended** (not deleted), new ones are created for the Class 12 section's offerings, and the student's class becomes 12 (it always comes from the section). Past attendance, exam attempts and ranks stay with the Class 11 section.
- **Remove:** **Deactivate** is the default (login blocked, data kept). **Permanent delete** requires a confirmation and **anonymises** the account: the User row stays (so attendance, exam and chat records still point to it) but name, email, mobile, photo, login ID and all profile details are erased, logins are revoked, and the user's posts are shown as "Deleted user". Daily backups age out after 30 days (Section 8).
- **Credential slip:** printable/copyable ID + initial password.

### 4.5 Pass-Out Rule
- **Only the Admin closes a session, manually.** The system never closes a session by date or automatically; the Admin decides when a session is finished.
- The Admin's *Sessions* page shows every session with its status (**Active** / **Closed (Passed Out)**), so the Admin always knows which sessions are still running.
- To close, the Admin opens the session and clicks **Close session (Mark Passed Out)** and confirms. The Admin can also mark individual students as Passed Out.
- Passed-out students are automatically logged out and blocked from logging in: *"Your account is inactive because your session has been completed."*
- They are removed from group/section chats; their data is archived and the Admin can view or delete it.

### 4.6 Security Requirements
- Passwords hashed with bcrypt/argon2. They are never stored, and never emailed in plain text after the first issue.
- **Server-side sessions stored in PostgreSQL** (a LoginSession row per login, in a secure httpOnly cookie; no plain long-lived JWTs). Every request checks the session and the user's status, so deactivating, blocking or marking a user Passed Out ends their sessions immediately. **WebSocket connections** are checked against the LoginSession when they connect, and the server closes them as soon as that session is revoked. Role **and assignment** checks on every API (e.g. a teacher can only edit exams of their own course offerings).
- Reset links expire in 15–30 minutes and are single-use.
- Rate limiting on login, reset, messaging and AI chat.
- **All uploaded files are private** (post and comment images, avatars, chat attachments, notes, previous questions, books). They are served only to logged-in users through short-lived signed links from the storage domain (separate from the portal's domain, so an uploaded file can never run scripts on the portal). Only landing-page notice attachments, the college logo/banner and book covers are public.

---

## 5. Functional Requirements

### 5.1 Landing Page (Public)
- College name, logo, banner, introduction; About, Departments, latest public **Central Notices**, Book Shop preview, Contact.
- **Login** button (top-right).

### 5.2 Separate Dashboards

#### 5.2.1 Admin Dashboard
- **Stats cards:** active sessions, students, teachers, sections, today's posts, books purchased this month, reported posts.
- **Quick actions:** create session, add student/teacher, assign courses, publish central notice, create pinned post.
- **Alerts:** sections with unassigned courses, reported content.
- **Charts:** students per group, exam participation, book purchases (monthly).
- **Menu:** Sessions & Sections, Courses, Teachers, Students, Section Mentors, Notices, Community Moderation, Book Shop, Previous Questions, Recorded Classes, Reports, Settings.

#### 5.2.2 Teacher Dashboard
- **Today:** today's classes from the routine, upcoming online classes with an **Open meeting** button, exams running now.
- **My Courses:** cards per course offering (section, student count), each opening a course workspace with tabs: *Classes · Recordings · Notes · Exams & Quizzes · Results · Notices · Attendance · Students*.
- **Pending work:** exam results waiting to be published, unread messages.
- **Section Mentor area** (only if a Section Mentor): section overview, students of the section, section routine (view only), section notices, pinned posts.
- **Menu:** Dashboard, My Courses, Routine, Feed, Messages, Notifications, Profile.

#### 5.2.3 Student Dashboard
- **Pinned posts** from Admin/Section Mentor (Section 5.7.2), then quick widgets:
  - Today's routine and next class; live class **Join** button when a class is live.
  - Upcoming exams/quizzes with countdown.
  - Latest notices (central + class-wise).
  - Attendance summary (% per course).
  - Recent results.
- **Menu:** Home/Feed, My Courses, Live Classes, Recorded Classes, Notes, Exams, Progress, Previous Questions, Routine, Attendance, Notices, Messages, Book Shop, AI Assistant, Profile.

### 5.3 Admin Panel Functions
| Area | Functions |
|---|---|
| **Sessions** | Create session (auto-creates 3 groups), move students from Class 11 to Class 12 (Section 4.4), mark Passed Out, archive. |
| **Sections** | Add / rename / remove sections per group (max 30 students each); move students between sections. |
| **Courses** | Manage catalog; assign courses + course teachers per section (Section 3.3); copy assignments. |
| **Schedule Manager** | One portal to add / edit / delete the routine, periods, classrooms (rooms), holidays, special days and single-class changes (Section 5.17.1). Includes a calendar view. |
| **Teachers / Students** | Add, bulk import, edit, deactivate, delete, reset password (Section 4.4). |
| **Section Mentors** | Exactly one per section (e.g. Science-A, Science-B, Science-C → 3); change at any time; auto-joins the section chat and the group chat. |
| **Central Notices** | Section 5.9. |
| **Community** | Create/edit own posts (pinned by default with the "Pin this post" switch; until seen, max 7 days), delete any post/comment, review reports, mute a user from posting (temporary). |
| **Book Shop** | Section 5.19. |
| **Previous Questions / Recorded Classes** | College-wide uploads (Sections 5.12, 5.16). |
| **Reports** | Export students, results, attendance and book purchases as CSV/PDF. |
| **Student 360°** | One-click full view of any student (Section 5.3.1). |

#### 5.3.1 Student 360° View (One-Click Student Details)
- **Open in one click:** Admin searches by **Student ID, name, roll or phone** from the global search bar, or clicks any student's name/photo anywhere in the portal (feed, comments, student lists, attendance sheets, exam results).
- A single page shows **everything** about the student, organized in tabs:

| Tab | Shows |
|---|---|
| **Overview** | Photo, all profile info, Student ID, session / group / section / class, roll, status, email, mobile, guardian info, address, DOB, account created date, last login |
| **Academic** | Enrolled courses with their teachers, personal routine |
| **Attendance** | Overall % and per-course %, calendar view, every record (date, period, course, teacher, status), edit history |
| **Exams & Progress** | Every exam and quiz attempt, marks, grades, progress charts, integrity logs (tab switches etc.) |
| **Community** | Every post, every comment, every reaction (and what it was on), reports made by and against the student |
| **Book Shop** | Purchased books (book, price, date) |
| **Activity Log** | Login history, devices, password resets, warnings / mutes |

- **Quick actions on the same page:** reset password, deactivate / reactivate, move section, send message, warn / mute, delete a post or comment.
- **Export:** download the full student report as **PDF**.
- Teachers and Section Mentors do **not** get this view; they see only the profile and course data of students they teach or of their own section.

### 5.4 Section Mentor Functions
- Is the main teacher in charge of **one section** (e.g. *2024–25 · Science · A*). The Admin assigns exactly one per section.
- View all students and course offerings of the section.
- View the **class routine** of the section (only the Admin can change it).
- Publish **section notices** (to all students of the section).
- Create posts for students of their section, **pinned by default** ("Pin this post" switch; shown at the top until each student has seen it, max 7 days). Can switch it off for a normal post.
- Monitor the section: exam results, attendance summaries, inactive students.
- Message any student individually; post announcements in the section chat.
- Cannot assign teachers, substitutes, cancel classes or change the routine; these are decided by the Admin only.

### 5.5 Course Teacher Functions
All of these work only within the teacher's assigned course offerings:
- Create and run **online classes** (5.11) and upload **recordings** (5.12).
- Upload **notes & materials** (5.13) and **previous-year questions** (5.16).
- Create, schedule and grade **exams & quizzes** (5.14); publish results.
- Publish **class-wise notices** (5.9).
- Take and manage **attendance** per period (5.18).
- View the student list and each student's progress in the course.

### 5.6 Student Portal Functions
- **Profile:** picture, name (Admin can lock), Student ID / session / class / group / section (read-only), email (with verification), mobile, bio, DOB, address, guardian contact.
- **My Courses:** every course offering of their section with teacher name; each opens tabs: *Live Classes · Recordings · Notes · Exams · Results · Notices · Previous Questions*.
- Everything else as described in Sections 5.7–5.20.

### 5.7 Social Media Platform (Community)

#### 5.7.1 Posts, Reactions & Comments
- **Create post:** text (required), up to **10 images**, optional link or PDF. Optional tag: *General*, *Problem / Need Help*, *Study*, *Event*, so students can share problems and others can filter for them.
- **Reactions:** 👍 Like, ❤️ Love, 😆 Haha, 😮 Wow, 😢 Sad, 😡 Angry. One per user per post; can change or remove.
- **Comments:** text, links, images, PDF. One level of replies. Comment count shown.
- Edit / delete own post or comment ("edited" label shown).
- **Report** post/comment with a reason; it goes to Admin moderation.
- **Visibility:** every active student, teacher and the Admin can see every post (college-wide feed).
- **Author info on every post and comment:** photo and name, and for a student author also **session · group · section** (e.g. *2024–25 · Science · A*). For a teacher it shows "Teacher" (plus "Section Mentor · 2024–25 Science-A" if they mentor a section); for the Admin it shows "Admin".
- **Public profile:** clicking the author's name or photo opens their **public profile**, which any logged-in user can view. It shows: photo, name, role, session / group / section / class (students), courses taught (teachers), bio, and their recent posts. It **never** shows private details (email, mobile, address, DOB, guardian info) and **does not show the Student ID** (the Student ID is the login ID; only the student, their teachers and the Admin see it). The Admin still opens the full Student 360° view instead (5.3.1).
- **Inactive authors:** their posts and comments stay visible. For a **passed-out or deactivated** user, the public profile shows only photo, name and the note *"This account is no longer active."* Nothing else (no session/section, bio or posts list). A permanently deleted user appears as "Deleted user" with no profile (4.4).

#### 5.7.2 Admin & Section Mentor Pinned Posts
- Admin can **create, edit and delete** posts like any user; Admin can additionally **delete any post or comment**.
- A post created by the **Admin** or a **Section Mentor** is **pinned** so that nobody misses it, even a student who logs in a few days later. The create form has a **"Pin this post"** switch, **on by default**; turning it off makes a normal post. Pinning can only be chosen when the post is created (the Admin can still unpin or extend later).
  - Admin posts are pinned for **everyone**.
  - Section Mentor posts are pinned for **students of that mentor's section** (each section has exactly one mentor). Everyone else sees them only in the normal feed.
- **Seen once, then it leaves the top.** The pinned post stays at the top of the feed/dashboard **for each user until that user has seen it once**.
  - **Seen** = at least half of the post was visible on the user's screen for at least 1 second (feed or dashboard). The browser then tells the server, which saves one PostView record. Being in a loaded page but scrolled out of view, or collapsed under "Show N more announcements", does **not** count.
  - One PostView record covers **both** the feed and the dashboard: seen in one place means it leaves the top in both.
  - The next time the user opens or refreshes the feed/dashboard, the post is no longer at the top; it is only in the normal timeline at its original date. (It does not jump away while the user is still looking at it.)
- **7-day limit.** A pin lasts at most **7 days from creation**. After 7 days it is no longer shown at the top for anyone, even users who never saw it. The post itself is **not deleted**; it stays in the normal timeline.
- Pinned posts carry a badge: **"📌 Admin"** or **"📌 Section Mentor · 2024–25 Science-A"**.
- **Feed order:** (1) pinned Admin posts the user has not seen yet, newest first → (2) pinned Section Mentor posts the user has not seen yet, newest first → (3) all other posts, newest first.
- **If there is no unseen Admin/Section Mentor post from the last 7 days, nothing is pinned**, and the feed starts directly with regular posts.
- Admin can **unpin early** (removed from the top for everyone) or **extend** a pin. Extending only gives more time to users who **have not seen it yet**; users who already saw it do not get it at the top again. Editing a post does not restart the 7-day timer and does not re-pin it for anyone.
- The pin audience is saved when the post is created. If the section later gets a different mentor, the old mentor's pins stay valid for that section until they expire.
- At most **5 pinned posts** are shown expanded; any more collapse into "Show N more announcements".
- Creating a pinned post sends a notification to its audience.

#### 5.7.3 Moderation
- Admin moderation queue: reported items with reason, reporter count, quick actions (*Dismiss · Delete · Delete & warn · Mute user for N days*).
- Deleted content is soft-deleted (hidden, kept 30 days for audit) and the author is notified.
- **Mute** stops the user from creating posts, comments and chat messages (all chats) until it ends; they can still read everything. A **warn** only notifies the user.
- Optional automatic filter for a configurable list of banned words (the post is held for review).

### 5.8 Messaging System
- **One-to-one chat:** students ↔ students, teachers ↔ students, Admin ↔ anyone.
- **Group chat** per session-group (all students of the group + the Section Mentors of its sections, auto-joined).
- **Section chat** per section (students + the Section Mentor + course teachers of that section, auto-joined).
- Text, emoji, images, links, PDF attachments.
- Real-time delivery (WebSockets), typing indicator, unread counts, seen status.
- Block / report a user from every chat, and report a single message. Admin can review reported conversations only (the reported message with the messages around it).
- **Banned words in chat:** a message containing a banned word is **not sent**; the sender sees "This message contains a blocked word." (Chat is real-time, so messages are never held for review like posts.)
- Students may be under 18. The client chose to keep 1-to-1 chat open to everyone as listed above, with block/report on every chat, banned-word filtering and Admin warn/mute; no extra age-based chat rules are built.
- Passed-out students are removed from group/section chats automatically.

### 5.9 Notices

| | **Central Notice** | **Class-wise Notice** |
|---|---|---|
| Published by | Admin | Course teacher / Section Mentor |
| Audience | Entire college, or filter: role / session / group | Selected course offering(s), section(s) or own section (Section Mentor) |
| Content | Title, rich text, attachments (PDF/image), priority (Normal / Important / Urgent) | Same |
| Extras | Show on public landing page (optional), publish now or schedule, expiry date | Publish now or schedule, expiry date |

- Students see a unified **Notices** page with filters (Central / My Classes) and an unread indicator.
- *Important* and *Urgent* notices also trigger an **email** (from Phase 3, Section 10); *Urgent* notices appear as a banner on the dashboard until read.
- **Email sending:** SMTP through a **free Google account** (no paid service). Emails go through a **queue with rate limiting** that stays under Google's daily sending limit (about 500/day for a personal Gmail; the Admin sets the limit in Settings). If more emails are waiting than the limit allows, the rest are sent the next day; in-app notifications are never delayed. Password-reset and verification emails go first.

### 5.10 Notifications
- **In-app notification center** (bell icon with unread count), delivered in real time over WebSockets.
- **Email** for important events (configurable per user, except for urgent notices).
- **Browser push notifications** (Phase 3).

| Event | Student | Teacher |
|---|:-:|:-:|
| New central / class-wise notice | ✅ | ✅ (central) |
| Online class scheduled / starting in 15 min | ✅ | ✅ |
| New recording / notes uploaded in my course | ✅ | – |
| Exam/quiz published, starting soon, result published | ✅ | – |
| New pinned Admin/Section Mentor post (an unpinned post is a normal post and sends no notification) | ✅ | ✅ (Admin) |
| Reaction / comment on my post, new message | ✅ | ✅ |
| Course assignment changed | – | ✅ |

### 5.11 Online Classes (Live)
- **No paid video service and no video room inside the portal.** The portal only schedules the class and shares the meeting link; the class itself runs on a **free** external tool.
- **Teacher creates** an online class for one or more of their course offerings: title, topic, date & time, duration, description and the **meeting link**.
- **Free meeting tools the teacher can use** (any link is accepted):

| Tool | Cost | Limits on the free plan | Notes |
|---|---|---|---|
| **Google Meet** (recommended) | Free with any Gmail account | Group calls limited to about **60 minutes** on a personal account | Most students already know it and have the app. For longer classes the teacher starts a new link, or the college applies for the free *Google Workspace for Education Fundamentals* plan (if eligible). |
| **Jitsi Meet** (meet.jit.si) | Free, no account needed for students | No time limit | Teacher (moderator) signs in with Google/GitHub to start the room. Opened as a link in a new tab, not embedded. |

- Students get a notification when the class is scheduled and 15 minutes before it starts. The **Join** button activates 10 minutes before start and opens the meeting link in a new tab.
- Statuses: *Scheduled → Live → Ended / Cancelled*. Teacher can reschedule, change the link or cancel (students notified).
- Only students enrolled in the course offering see the link inside the portal.
- The portal logs **which students clicked Join and when**. It cannot see how long they stayed in Meet/Jitsi; this log only pre-fills the attendance sheet (Section 5.18.3).
- **Online class in a routine period:** if the online class is held at the time of an existing routine Class Meeting of the same course offering (e.g. a routine class moved online), it is **attached to that meeting** instead of creating a second one, so attendance is never counted twice. Otherwise a new Class Meeting is created for it. One online class can link to several meetings (one per section it covers); the link is stored on the Class Meeting only (`online_class_id`).
- **Recording:** not done by the portal. If the teacher wants a recording, they record it themselves (e.g. free OBS Studio or phone screen recorder), upload it to YouTube and share the link as a Recorded Class (Section 5.12).

### 5.12 Free Recorded Classes
- **The portal does not record or store videos.** The teacher records the class themselves, uploads it to **YouTube** (Unlisted recommended) and shares the link in the portal.
- Teachers (own courses), Section Mentors and the Admin add a recorded class with: title, course, chapter (picked from the course's chapter list), description and the **YouTube link** (a Google Drive link is also accepted).
- As soon as the link is saved, the video appears automatically for the students of that course in an embedded YouTube player; students get a notification.
- **Visibility:** *My section only* or *Free for all students* (college-wide free library).
- Students browse by course → chapter, search, and watch in an embedded player. "Watched" progress is shown per video.
- Replaces the "Previous Class Links" feature from v1.0.

### 5.13 Notes & Study Materials
- Teachers upload notes for their course offering: title, chapter, description, files (PDF, DOC/DOCX, PPT, images) or links.
- Organized by course → chapter; students view in the browser or download.
- **Chapters:** each course has a simple chapter list (name + order), kept by the Admin in the course catalog; teachers can add a chapter to their own course. Notes, recordings and bank questions pick a chapter from this list (no free typing), so "strong/weak chapters" (5.15) work.
- Students get a notification for new materials. Teachers can see the view/download count.
- A Section Mentor can share common materials with their section; the Admin with a group or the whole college.

### 5.14 Online Exam & Quiz

#### 5.14.1 Teacher: Creating & Managing
- Created per **course offering** (subject-wise), from scratch or from the teacher's **question bank**.
- **Type:** *Exam* (formal, one attempt, results counted in progress) or *Quiz* (practice/class test, may allow multiple attempts).
- **Question type: text-based MCQ only.** Every question is a text question with text options, and the student just selects an answer. There are no written, short-answer or fill-in-the-blank questions, and students never upload files or images.
  - MCQ – single correct answer
  - MCQ – multiple correct answers (optional per question)
- **All grading is automatic.** Marks are calculated the moment the student submits; the teacher never grades by hand.
- **Scoring rules (simple):**
  - **Right answer = the question's marks** (default 1). **Wrong or unanswered = 0.**
  - **No negative marking and no partial marks.** For a multiple-correct question, the answer is right only if the student selects exactly all the correct options; otherwise it is wrong.
  - **Quizzes with several attempts:** the **best** attempt counts for progress and rank. All attempts stay visible to the student and the teacher.
- **Settings:** start & end window, duration (timer, chosen from **fixed presets**: 15, 30, 45, 60, 90, 120 minutes; no free typing), total marks, pass marks, shuffle questions/options, number of attempts, show correct answers after the exam ends (yes/no), result publish mode (instantly / manually).
- **Server-side deadline:** when a student starts, the **server** saves `started_at` and the deadline (the earlier of start + duration and `end_at`). The server rejects any answer or submit after the deadline, and auto-submits at the deadline even if the browser is closed. The on-screen timer is only a display.
- **Time rule:** a student's exam ends at the **earlier of (start time + duration) and the window end**. Example: window 8–10 PM, 45-minute exam, student starts at 9:50 → the exam auto-submits at 10:00.
- **Correct answers are shown only after the exam window has ended (`end_at` passed) and every extra-time attempt has finished**, never right after one student submits, so answers cannot be shared while others are still taking the exam. Until then the server **never sends the correct answers to the browser**; grading happens on the server only.
- **Questions are never sent before `start_at`.** A student receives the questions only when their own attempt starts.
- **Results before the window ends:** with "publish instantly", a student sees only their **total score** after submitting. Per-question right/wrong, correct answers and **ranks** appear only after the window (and any extra time) has ended, so ranks do not change while others are still taking it.
- **Fixing a wrong answer key:** after the exam has started, the teacher can still **correct a question's answer** or **cancel a question** (everyone gets its marks). The server then regrades every attempt automatically; the change is logged and students are notified. Nothing else in a started exam can be edited.
- **Extra time for one student** (e.g. power cut, phone died): the teacher can give one student extra minutes on their attempt (this moves that attempt's deadline, even past `end_at`) or reopen an auto-submitted attempt with extra minutes. Saved answers stay. Every extension is logged with who gave it.
- **Question snapshot:** when an exam is published, the question text, options and correct answer are **copied into the exam**. Later edits to the teacher's question bank do not change published or past exams. The teacher can still edit a published exam **before its start time**, which copies the questions again; once the exam has started, it is locked (except fixing an answer key, below).
- **Reports:** score distribution, highest/average/lowest, per-question correctness, list of students who did not attend. Export as CSV/PDF.

#### 5.14.2 Student: Taking an Exam
- Students see upcoming, live and completed exams for their courses.
- During the exam: countdown timer, question navigator, "mark for review", **auto-save** every answer, auto-submit when time ends.
- If the connection drops, the student can resume before their deadline. **The clock keeps running while they are offline**; the deadline moves only if the teacher gives extra time (5.14.1). The shuffled question and option order is saved on the attempt, so it stays the same after resuming.
- **Integrity measures:** one in-progress attempt per student per exam (a quiz's next attempt can start only after the previous one is submitted), tab-switch/fullscreen-exit events logged and shown to the teacher, randomized order. (A web exam cannot fully prevent cheating; these measures discourage and record it.)

### 5.15 Exam Progress
- **Student view:**
  - List of all results by course: marks, percentage, grade (configurable HSC grading scale: A+, A, A-, B, C, D, F), and **rank**.
  - **Ranks are always shown to students, by section only.** Every exam/quiz is created by the **course teacher** for one course offering, which belongs to one section, so the rank is among the students of that section who took it. Plus an overall rank per course (also within the section) = the student's **average percentage over all published Exams** of that course offering (a missed exam counts as 0%). Quizzes are practice and do not count in the overall rank; each quiz still has its own rank (best attempt). There is **no group-wide or college-wide rank**. Students with equal marks share the same rank (e.g. 1, 2, 2, 4).
  - **Progress charts:** score trend over time per course, comparison with the section average, strong/weak chapters (based on question tags).
  - Downloadable result summary (PDF).
- **Teacher/Section Mentor view:** per-student and per-section progress; list of students below the pass mark.
- **Admin view:** college-wide performance by session/group/section/course.

### 5.16 Previous Exam Questions
- Admin and teachers upload previous-years' questions: course, year, exam type (HSC Board / Test / Pre-test / Half-yearly / Model test), board name (optional), PDF or images, optional solution file.
- Students browse by **course → year → exam type**, view in the browser, download.
- Search and filter by year and exam type.

### 5.17 Class Routine
- **The Admin allocates the class routine for every session**: for each session → group → section, the Admin fills a days × periods grid. Each cell = course offering (course code + title) + time + room; the teacher is filled in automatically from the course assignment.
- **Combined class in the routine:** one routine slot can hold several course offerings (e.g. Physics 1st of Science-A and Science-B, same teacher, same room). It creates **one** Class Meeting covering all of them and is not flagged as a teacher double-booking.
- **Periods and rooms are managed by the Admin** in the Schedule Manager (Section 5.17.1): the Admin creates the college's periods (name, start time, end time) and rooms, then picks them on each routine slot.
- **Only the Admin can create or change the routine.** Section Mentors and teachers can only view it.
- This routine is what drives attendance: every routine slot becomes a class the teacher takes attendance for (Section 5.18).
- **Conflict check:** warns if a teacher is double-booked in two sections at the same time.
- **Student view:** weekly grid + "today" list; current/next class highlighted.
- **Teacher view:** their personal weekly routine, built automatically from all sections they teach.
- Alternative: upload the routine as an image/PDF (kept from v1.0) for quick use.
- Changes to the routine notify affected students and teachers.
- **Routine changes apply from the next class onward.** Past Class Meetings and their attendance are never changed. Future Class Meetings that have no attendance yet are rebuilt from the new routine.
- **Academic calendar (Admin only):** the Admin decides when classes run and marks **holidays / off days** (one date or a date range, e.g. Eid vacation). No Class Meetings are generated on those days, and if the Admin adds a holiday later, the future meetings on those dates (with no attendance yet) are removed. Teachers and students see holidays on the routine and the attendance calendar.
- **The Admin is responsible for a correct routine.** The system does not reconcile or resolve clashes between the old and new routine; the conflict check above is only a warning.

#### 5.17.1 Admin Schedule Manager (everything is Admin-controlled)
One Admin area where the Admin can **add, edit and delete** every part of the schedule. Teachers, Section Mentors and students can only view.

| Item | What the Admin can do |
|---|---|
| **Periods** | Add / edit / delete periods (name, start time, end time), e.g. Period 1 = 08:00–08:45. |
| **Rooms** | Add / edit / delete rooms (name, optional capacity/building). |
| **Routine** | For each session → group → section: assign course offering, day, period and room to every slot; add, edit, move or delete any slot; copy a routine from another section or session. |
| **Holidays / off days** | Add, edit or delete a holiday (one date or a range, e.g. Eid vacation, public holiday, exam break). |
| **Single day / single class** | Change one date only without touching the routine: add an extra class, move a class to another period or room, cancel a class, assign a substitute teacher, or delete a future class. |
| **Whole-day changes** | Mark one date as a special day (e.g. half day, exam day) and pick which periods run (a list of period IDs). On that date, only routine slots in the listed periods create Class Meetings; the others are not created. A Holiday cancels the whole day; a special day only shortens it. If a listed period is later deleted, it is removed from the list. |

- **Calendar view:** the Admin sees a month/week calendar showing holidays, special days, routine classes and one-off changes. The Admin can click any date or class to add, edit or delete it right there, and can filter by session, group, section, teacher or room.
- **Classrooms (rooms):** the Admin manages the list of classrooms and can see which rooms are free or used in each period, to avoid double-booking (shown as a warning only, never blocking, like the teacher conflict check in 5.17). The check runs on Class Meetings (date + period + room), so it also covers extra classes, special days and single-class room changes.
- Every change **applies to future classes only** and keeps the rules in 5.17: past Class Meetings and their attendance are never changed; a future meeting that already has attendance is not deleted (the Admin must cancel it instead).
- Deleting a period or room that future routine slots use asks the Admin to **choose a replacement** or delete those slots first. Past meetings keep the period times and room they had.
- Deleting a routine slot (or a period/room) is a **soft delete** (hidden, `deleted_at` set), so past Class Meetings still point to it.
- Affected students and teachers are notified of every change (5.10).
- All changes are written to the **AuditLog**.

### 5.18 Attendance (Per Period)

#### 5.18.1 How Attendance Is Organized
- **Most attendance is taken by teachers in the physical classroom.** The teacher goes to the class, opens the attendance sheet on their phone or laptop and marks the students. Online classes (5.11) also have attendance, but they are the smaller case.
- Attendance is taken **per class period**, not per day.
- Every **routine slot** (e.g. *Sunday 10:00 · Physics 1st · Science-A · Mr. Rahman*) automatically generates a **Class Meeting** for each date it occurs. Online classes (5.11) are also Class Meetings.
- **Generation:** a nightly background job creates the Class Meetings for the **next 14 days** (skipping holidays and periods not listed on a special day); any routine or calendar change re-runs it for the affected dates. A future meeting the Admin deletes is kept with status `removed` (not erased), so the job never creates it again; it is hidden everywhere and not counted.
- Each Class Meeting has one **attendance record per student**: **Present / Absent / Late / Excused**.
- Every record stores **date, period, course offering, section, teacher and student**, so the same data can be summarized per student, per course, per section, per teacher, per day or per month.

#### 5.18.2 Students in Different Classes / Teachers in Different Sections
| Case | How it is handled |
|---|---|
| **Normal class** | The class list is every student enrolled in that course offering. |
| **Optional courses** (e.g. Biology vs Higher Math) | Only students enrolled in the optional course appear on that teacher's list. |
| **Combined class** (e.g. Science-A + Science-B together) | One Class Meeting covers both course offerings; the teacher sees both class lists on one screen. |
| **Teacher teaching many sections** | The teacher's "Today's Classes" lists every period from all sections they teach, each with its own attendance sheet. |
| **Substitute teacher** | Only the Admin assigns a substitute for a single Class Meeting; the substitute can take attendance for it. |
| **Cancelled class** | Only the Admin marks the meeting *Cancelled*; it is not counted in anyone's percentage. |

#### 5.18.3 Taking Attendance (Teacher)
Teacher dashboard → **Today's Classes**:
```
Today – Sunday
10:00  Physics 1st · Science-A   [Take Attendance]  ✅ done
11:00  Physics 1st · Science-B   [Take Attendance]  ⏳ pending
12:30  Physics 2nd · Science-A   [Take Attendance]
```
**A. In the classroom (the main way)**
1. The teacher is in the class and opens the attendance sheet in one of two ways:
   - **From the routine:** taps **Take Attendance** next to the period in *Today's Classes* (everything is pre-selected from the Admin's routine), or
   - **By selecting it manually:** *Attendance → Take Attendance* → choose **Session → Group → Section → Course (course code + course title)** → date and period. Only the courses assigned to that teacher can be chosen. If there is no routine slot for that time (e.g. an extra class), a new Class Meeting is created for it.
2. The sheet header shows **course code, course title, session, group, section, date, period and teacher**, followed by the class list (photo, roll, name), with everyone **Present** by default.
3. Teacher taps a student to switch to **Absent / Late / Excused** → **Submit**. The sheet is saved and every student's percentage updates immediately.
   - **Weak signal:** the unsent sheet is kept as a draft on the device (browser storage). If Submit fails, the teacher sees "Not sent, retry" and nothing is lost.

```
Physics 1st Paper (PHY-101) · 2024–25 · Science · Section A
Sunday 15 Nov 2026 · Period 2 (10:00) · Mr. Rahman
Roll  Name             Status
01    Ayesha Akter     Present
02    Rahim Uddin      Absent
03    Nusrat Jahan     Late
                       [Submit]
```

**B. Online classes**
4. Students who clicked **Join** are pre-filled as Present and the rest as Absent; the teacher reviews (e.g. against the Meet/Jitsi participant list) and submits.
**C. For both**
5. Teacher can edit attendance of their own Class Meetings; Section Mentor and Admin can edit any record in their scope.
6. **Missed period:** the teacher can open a past Class Meeting from the course's *Attendance* tab and take attendance for that date.

**Teacher dashboard attendance widgets:**
- Pending (not yet taken) periods for today and past days.
- Average attendance % per course offering.
- **Low-attendance list:** students below **75%** in the teacher's courses.
- Course *Attendance* tab: register view (students × dates grid), filter by month, export CSV/PDF.

#### 5.18.4 Calculation Rules
- **Attendance % = (Present + Late) ÷ (Classes held − Excused) × 100**, calculated per course and overall.
- **Required attendance: 75%** (Admin-configurable).
- Cancelled meetings and holidays are not counted.
- **Classes held is counted per student** = meetings where attendance was taken **and that student has a record** (so a student who joined or moved section mid-term, or takes an optional course, is measured only against their own classes). A meeting whose attendance was never taken is **not counted** and shows as **"Not taken"** to the teacher, Section Mentor and Admin (5.18.6).
- If no classes count yet (Classes held − Excused = 0), the percentage shows **"N/A"**, not 0% and not a warning.
- Color status: 🟢 ≥ 75% · 🟠 60–74% · 🔴 < 60%.

#### 5.18.5 Student Dashboard View
```
┌ My Attendance ───────────────── Overall 82% ┐
│ Physics 1st      ███████████░  88%  🟢       │
│ Chemistry 1st    ████████░░░░  71%  🟠       │
│ English 1st      ██████░░░░░░  58%  🔴 Warning│
└─────────────────────────────── [View details]┘
```
- **Dashboard card:** overall % and per-course % with progress bars and colors.
- **Details page:**
  - **Calendar view:** each day colored (all present / partly absent / absent / no class); clicking a day shows each period with course, teacher and status.
  - **Course-wise list:** date, period, teacher, status for every class.
  - Filters: month, course, session.
- **Notifications:** student is notified when marked absent and when any course drops below 75%.

#### 5.18.6 Section Mentor & Admin View
- **Section Mentor:** attendance summary for every course of their section, daily "not taken yet" list, low-attendance students.
- **Admin:** college-wide summary by session / group / section / course / teacher; teachers who have not taken attendance; full per-student details via **Student 360°** (5.3.1).
- Exports: attendance register (CSV/PDF) for any section and date range.

### 5.19 Book Shop (Digital PDF Books Only)
- The shop sells **only digital books (PDF)**. No printed books, no cart, no stock, no delivery and no cash on delivery.
- **Admin manages the catalog:** title, author, publisher, course/group/class, cover image, description, price (shown to students), PDF file, optional free preview pages.
- **Students:** browse/search/filter by group & course → book details → **Pay** button.
- **Pay button (no payment gateway in this version):**
  - Clicking **Pay** shows a short confirmation and then **immediately unlocks the PDF**. No bKash, SSLCommerz, card or any real payment is connected, and no money is collected.
  - The book is saved to the student's **My Books** list, where they can read it in the portal's PDF reader or download it any time.
  - Each "purchase" is stored (student, book, price, date) so a real payment gateway can be added later without changing the student's flow.
  - ⚠ Because nothing is actually charged, any logged-in student can unlock any book. This is accepted for this version.
- **PDF protection:** PDFs are served only to logged-in students who have unlocked the book, through short-lived signed links (not public URLs).
- **Free preview:** when the Admin uploads a book, the server cuts the chosen preview pages into a **separate small PDF**. Students who have not unlocked the book only ever receive this preview file, never the full PDF.
- **Admin:** purchase list with filters (book, student, date), most-unlocked books report.
- Free book PDFs from v1.0 remain available under **Notes & Materials**.

### 5.20 AI Chatbox (Student Study Assistant)
- A chat assistant for **students only**, available from the menu and as a floating button.
- **Purpose:** explain concepts, solve and explain problems step by step, summarize topics, generate practice questions, and help with English/Bangla writing. It is scoped to academic help, and off-topic or harmful requests are politely declined.
- **Zero cost: powered by the free tier of the Groq API** (GroqCloud Free plan; a payment method is only needed to upgrade). Use an open model that is on the free tier at build time (e.g. a Llama 70B-class model); the model name is a setting so it can be changed without code changes.
- **Why Groq:** Groq does not use API inputs or outputs for training, and its free tier is enough for a daily per-student limit. Students may be under 18; Groq's terms allow apps used by minors, and the college is responsible for that use. The Groq account (not Gemini, whose terms forbid under-18 users) is owned by the college/developer.
- **Free-tier limits to plan around:** Groq caps free requests and tokens per minute and per day for the **whole account** (shared by all students, not per student), and the numbers change from time to time (check the Groq console before launch and run a short load test). So:
  - Admin sets a **daily message limit per student** (e.g. 15–20) so a few students cannot use up the whole day's quota.
  - When the free quota is used up, students see *"The AI assistant is busy, please try again later"* instead of an error.
  - Only one Groq account is used; never create extra free accounts to get around the limits (Groq's terms forbid this).
- **No personal data is sent to the AI** (name, ID, phone, section), only the student's question and the chat so far.
- **Provider is configurable** (provider + model in Settings). Any replacement provider must be free and must not train on student messages.
- Students can start new chats, see past chats, and write in **Bangla or English**. Supports formatted math/code in answers.
- **AI chats are private to the student.** Teachers and the Admin cannot read them (they are not in Student 360°; the Admin sees only usage counts). The student can delete a chat at any time; all AI chats are deleted when the account is permanently deleted.
- **Safety:** server-side calls only (key never exposed), no access to other students' data, disclaimer "AI may make mistakes, verify with your teacher".
- **During a live exam, the AI chatbox is disabled** for students taking that exam.
- **Phase 3 (Section 10):** answers grounded in the college's own uploaded notes (course-aware assistant).

---

## 6. Data Model (High Level)

| Entity | Key Fields |
|---|---|
| **User** | id, login_id, email, email_verified_at, mobile, password_hash, role (admin/teacher/student), status (active/inactive/passed_out/deleted), first_login, avatar_url, totp_secret and backup_code_hashes (Admin only) |
| **StudentProfile** | user_id, name, name_locked, section_id (current section; session, group and class are read from the section, never stored twice), roll, bio, dob, address, guardian_contact |
| **TeacherProfile** | user_id, name, designation, subjects[], bio |
| **Session** | id, name, status, created_at |
| **Group** | id, session_id, type (science/commerce/arts) |
| **Section** | id, group_id, class (11/12), name (A/B…), mentor_teacher_id (unique: one mentor per section); max 30 active students, checked when adding or moving |
| **Course** | id, code, name, group_type, class, paper, is_optional |
| **Chapter** | id, course_id, name, order (unique course + name) |
| **CourseOffering** | id, section_id, course_id, teacher_id, created_at (unique section + course) |
| **Enrollment** | id, course_offering_id, student_id, status (active/ended), enrolled_at, ended_at (a row for **every** student in every offering they take; ending keeps history; only one active row per student + offering) |
| **Period** | id, name, start_time, end_time, deleted_at (managed by the Admin, Section 5.17.1) |
| **Room** | id, name, capacity (optional), building (optional), deleted_at (managed by the Admin) |
| **RoutineSlot** | id, day, period_id, room_id, deleted_at (soft delete; past meetings keep pointing to it) |
| **RoutineSlotOffering** | routine_slot_id, course_offering_id (unique pair; one row normally, several for a combined class; the section comes from the offering) |
| **Post** | id, author_id, text, tag, pinned_until, pin_audience (all/section), pin_section_id (null = everyone), status, created_at |
| **PostView** | post_id, user_id, seen_at (unique post + user; a pinned post is hidden from the top once a row exists) |
| **PostMedia** | id, post_id, url, type |
| **Reaction** | post or comment ref, user_id, type (unique user + post/comment) |
| **Comment** | id, post_id, parent_comment_id (null = top level; replies are one level only), author_id, text, attachments, status, edited_at |
| **Report** | id, reporter_id, target_type (post/comment/message/user), target_id, reason, status, created_at |
| **Conversation** | id, type (direct/group/section), ref_id (group or section), direct_key (sorted user pair, unique, for direct chats) |
| **ConversationMember** | conversation_id, user_id, joined_at, left_at, last_read_message_id (unread counts and "seen" status, also in group chats) |
| **Message** | id, conversation_id, sender_id, text, attachment, created_at, deleted_at |
| **Notice** | id, author_id, scope (central/class), audience_json, title, body, priority, attachments, publish_at, expires_at |
| **NoticeRead** | notice_id, user_id, read_at (unique notice + user; unread indicator and the Urgent banner) |
| **Notification** | id, user_id, type, ref, text, read_at, created_at |
| **OnlineClass** | id, teacher_id, title, start_at, duration, platform (meet/jitsi/other), join_url, status (its meetings are found by `ClassMeeting.online_class_id`) |
| **OnlineClassOffering** | online_class_id, course_offering_id (unique pair; one online class can cover several of the teacher's offerings) |
| **OnlineClassJoin** | online_class_id, student_id, clicked_join_at |
| **RecordedClass** | id, course_offering_id / course_id, chapter_id, title, video_source (youtube/drive), url, visibility |
| **Material** | id, course_offering_id / scope, chapter_id, title, file_url, type |
| **Question (bank)** | id, teacher_id, course_id, type, text, options_json (each option has a stable id), correct_json, marks, chapter_id |
| **Exam** | id, course_offering_id, kind (exam/quiz), title, start_at, end_at, duration, total_marks, pass_marks, settings_json, status |
| **ExamQuestion** | id, exam_id, question_id (source reference, nullable), order, marks, question_text, options_json, correct_json, chapter_id, is_cancelled (snapshot copied from the question bank when the exam is published; source question_id kept for reference only; correct_json/is_cancelled can change after start only through "fix answer key", which regrades) |
| **ExamAttempt** | id, exam_id, student_id, attempt_no, section_id (section at the time of the attempt, used for rank), started_at, deadline_at (earlier of start + duration and end_at, set by the server; moved only by extra time), extra_minutes, extended_by, question_order_json (shuffled question and option order), submitted_at, score, status (in_progress/submitted/auto_submitted), integrity_log (unique exam + student + attempt_no; at most one in_progress per exam + student) |
| **Answer** | attempt_id, exam_question_id (the snapshot that was graded), selected_option_ids, is_correct, marks_awarded (unique attempt + exam_question) |
| **PreviousQuestion** | id, course_id, year, exam_type, board, file_url, solution_url |
| **ClassMeeting** | id, routine_slot_id (null for an extra class), online_class_id (null if not online), date, period_id, room_id, start_time, end_time (copied from the period when created, so later period changes do not alter past meetings), teacher_id, substitute_teacher_id, status (scheduled/held/cancelled/removed; `removed` = deleted by the Admin, kept so it is never generated again); **UNIQUE(routine_slot_id, date)** so one routine slot can never create two meetings on the same day |
| **Holiday** | id, start_date, end_date, title, created_by (set by the Admin; no Class Meetings on these dates) |
| **SpecialDay** | id, date, title, session_id (optional), periods_json (which periods run that day; set by the Admin) |
| **ClassMeetingOffering** | class_meeting_id, course_offering_id (unique meeting + offering; a combined class has one row per offering) |
| **AttendanceRecord** | id, class_meeting_id, student_id, section_id (section at the time of the class), status (present/absent/late/excused), marked_by, marked_at (unique meeting + student) |
| **AttendanceEdit** | id, attendance_record_id, old_status, new_status, edited_by, edited_at |
| **Book** | id, title, author, publisher, course_id, price, cover_url, pdf_url, preview_pages, preview_pdf_url (separate preview file made on upload) |
| **BookPurchase** | id, student_id, book_id, price, payment_status (unlocked_no_gateway), purchased_at |
| **AIConversation / AIMessage** | id, student_id, title; conversation_id, role, content, tokens, created_at |
| **LoginSession** | id, user_id, token_hash, created_at, expires_at, last_seen_at, revoked_at, ip, user_agent (deleting or revoking the row logs the user out) |
| **Token (reset / verify)** | user_id, token_hash, purpose, expires_at, used |
| **Settings** | key, value_json, updated_by, updated_at (one row per setting: attendance threshold, attendance colours, grading scale, AI provider, AI model, AI daily limit per student, banned-words filter on/off, pin length) |
| **AIUsage** | student_id, date (Asia/Dhaka), message_count (unique student + date; checked before each AI call) |
| **AuditLog** | id, actor_id, action, target_type, target_id, changes_json, ip, created_at (every Admin action; never edited or deleted; **no personal data**: it stores IDs and the names of changed fields with non-personal old/new values, never names, emails, phones, addresses, DOB, guardian info or passwords) |
| **LoginHistory** | id, user_id, success, ip, user_agent / device, created_at (Student 360° Activity Log; failed logins feed rate limiting) |
| **UserSanction** | id, user_id, type (warn/mute), reason, related_report_id, starts_at, ends_at (null for warn), created_by |
| **Block** | blocker_id, blocked_id, created_at (unique pair; blocked users cannot message the blocker) |
| **BannedWord** | id, word, created_by, created_at (posts/comments containing one are held for review) |
| **RecordingProgress** | recorded_class_id, student_id, first_opened_at, last_opened_at (unique recording + student; "watched" = opened the link, since videos are on YouTube) |
| **MaterialView** | material_id, user_id, action (view/download), created_at (view and download counts) |

---

## 7. Key User Flows

**Flow A – Admin sets up a new session**
Create session "2025–26" → Science/Commerce/Arts auto-created → add sections (Science-A, Science-B…) → assign courses + course teachers per section (or copy from last session) → assign Section Mentors → bulk-import students into sections → credentials generated and shared.

**Flow B – Student first login**
Login with ID + password → complete profile (mobile, new password; verification link sent to the email) → dashboard (with a "verify your email" banner until verified) with pinned posts, today's routine, upcoming exams → auto-member of group and section chats.

**Flow C – Admin pinned post**
Admin → Feed → *Create post* ("Pin this post" on by default) → published with 📌 Admin badge → everyone notified → each user sees it at the top of their feed until they have seen it once → after that (or after 7 days for users who never logged in) it is only in the normal timeline.

**Flow D – Teacher runs a live class**
Teacher creates a free Google Meet link → My Courses → *Physics 1st – Science A* → Classes → *Schedule* (Sun 10:00) and pastes the link → students notified → students click *Join* (opens Meet in a new tab, click logged) → class ends → teacher reviews pre-filled attendance → later the teacher uploads their own recording to YouTube and adds the link under Recordings → students see it automatically.

**Flow E – Online exam**
Teacher creates exam (30 MCQ, 45 min, window Mon 8–10 PM) → students notified → student starts, answers auto-saved, auto-submit at time-up → all answers auto-graded instantly → teacher clicks *Publish results* (or results publish automatically) → students notified → Progress page updated.

**Flow F – Getting a book**
Student → Book Shop → opens *Physics 1st Paper Guide (PDF)* → clicks **Pay** → confirms → PDF unlocks immediately and opens in the reader → book saved under *My Books*.

**Flow G – Teacher takes attendance**
Teacher → Dashboard → Today's Classes → *11:00 Physics 1st · Science-B* → Take Attendance → mark 3 students Absent → Submit → absent students notified → percentages update on student dashboards.

**Flow H – Admin checks a student**
Admin → search "S-2024-0153" → Student 360° opens → Attendance tab (Chemistry 68% 🟠) → Community tab (all posts, comments, reactions) → Export PDF.

**Flow I – Session passes out**
Admin → Sessions → *2023–24* → *Mark Passed Out* → students logged out, login blocked, removed from chats, data archived.

---

## 8. Non-Functional Requirements

| Area | Requirement |
|---|---|
| **Performance** | Pages load < 2 s on 4G; feed paginates 20 posts at a time; chat messages delivered < 1 s. |
| **Scalability** | Support ~3,000 active users and ~500 students taking an exam at the same time. |
| **Availability** | 99.5% uptime; exams must not be scheduled during maintenance windows. |
| **Responsiveness** | Fully usable on mobile phones (most students use phones); PWA "add to home screen". |
| **Uploads** | Images (JPG/PNG/WebP) max **5 MB** each, resized/compressed on upload; PDF/DOC/DOCX/PPT/PPTX max **20 MB**; book PDFs max **100 MB** (Admin only); max 10 images per post or comment. File type checked by content, not only by extension. |
| **Security** | HTTPS everywhere, role + assignment-based authorization, input sanitization (XSS), file-type and size validation on uploads, signed URLs for private files, audit log for Admin actions. |
| **Privacy** | Students' personal details (mobile, address, guardian info, DOB) visible **only to the student and the Admin**. Teachers and Section Mentors see only profile and course data (Section 5.3.1). |
| **Backups** | Daily automatic database backups, kept 30 days; file storage with versioning. |
| **Timezone** | All times are shown in **Asia/Dhaka** and stored in **UTC** (routine, exams, attendance, pin expiry, holidays). |
| **Language** | UI in English; Bangla content supported everywhere (Unicode); Bangla UI can be added later. |
| **Accessibility** | Readable fonts, sufficient contrast, keyboard navigation for forms and exams. |

---

## 9. Technical Architecture (chosen)

Kept simple on purpose: **one codebase, one Node.js app, one PostgreSQL database, one server.**

| Layer | Choice |
|---|---|
| **App** | **One Next.js app (TypeScript)** with Tailwind CSS: pages and the REST API (route handlers) in the same project; responsive, PWA-enabled. It runs on a small custom Node server that also hosts Socket.IO (chat, notifications) and the background job worker, so there is one process to deploy and one cookie domain. |
| **Database access** | Prisma ORM; every schema change is a Prisma migration in the repo. |
| **Database** | PostgreSQL only (sessions, rate limits and background jobs are kept in PostgreSQL). **No Redis**; Socket.IO runs on a single server. |
| **Background jobs** | A PostgreSQL-backed job queue (e.g. pg-boss) for exam auto-submit at the deadline, the email queue, Class Meeting generation, scheduled notices and pin expiry. |
| **File storage** | S3-compatible object storage (AWS S3 / Cloudflare R2 / DigitalOcean Spaces) for images and PDFs (no videos). |
| **Live classes** | No integration: teacher pastes a free Google Meet or Jitsi Meet link. |
| **Recorded video** | Teacher's own YouTube (unlisted) link, shown in an embedded player. No video upload. |
| **Email** | SMTP through a free Google account, with a background job queue and rate limiting (Section 5.9). |
| **Payments** | None in this version (placeholder **Pay** button). A gateway can be plugged in later. |
| **AI** | Groq API free tier (open model, e.g. Llama 70B-class), called server-side only; provider and model configurable. |
| **Hosting** | One VPS (e.g. DigitalOcean / AWS, about 2 vCPU / 4 GB RAM) with Docker Compose (app + PostgreSQL) behind a reverse proxy with HTTPS (e.g. Caddy); daily backups. App errors are written to log files. |

---

## 10. Release Plan (Phases)

| Phase | Features |
|---|---|
| **Phase 1 – Core** | Auth & accounts (including auth emails: password reset, email verification, email change), sessions/groups/sections, course & teacher assignment, separate dashboards, profile, community feed with pinned posts & moderation, messaging, central & class-wise notices, in-app notifications, routine and Admin Schedule Manager (periods, rooms, holidays, daily schedule), **attendance** (it runs on the routine and is used every day). |
| **Phase 2 – Learning** | Online classes, recorded classes, notes & materials, previous-year questions, online exams & quizzes, exam progress, Student 360° view. |
| **Phase 3 – Extras** | Digital book shop (placeholder Pay button), free AI chatbox, notice/notification emails and browser push, the Admin **Reports** area, AI grounded in college notes. (Exports inside a feature, e.g. the attendance register or exam report CSV/PDF, ship with that feature.) |

**Phase 1 build order** (each step is usable on its own before the next starts): (1) auth & accounts → (2) sessions, groups, sections, courses, assignments → (3) routine, Schedule Manager & attendance → (4) notices & in-app notifications → (5) community feed & pinned posts → (6) messaging.

**Section 10 is the single source for phases.** If another section mentions a phase, this table wins. In Phase 1 the dashboards **hide the widgets** (exams, results) for features that are not built yet.
