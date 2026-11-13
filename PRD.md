# Product Requirements Document (PRD)
## College Management System (CMS)

| Item | Detail |
|---|---|
| **Document Version** | 2.6 |
| **Date** | 13 November 2026 |
| **Product Type** | Web-based College Management, Learning & Student Community Portal |
| **Target Institution** | Higher Secondary College (Class 11 & 12 – HSC) |
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
| **Session** | An academic batch, e.g. "2024–25". Moves Class 11 → Class 12 → Passed Out. |
| **Group** | Science, Commerce or Arts inside a session (auto-created). |
| **Section** | A division of a group, e.g. Science-A, Science-B. Created by the Admin. |
| **Course** | A subject from the college subject catalog, e.g. Physics 1st Paper. |
| **Course Offering** | One course taught to one section by one teacher, e.g. *2024–25 · Science · A · Physics 1st Paper · Mr. Rahman*. Most teaching features attach to a course offering. |
| **Section Mentor** | The teacher in charge of **one section**, assigned by the Admin. Every section has exactly one, e.g. Science A, B, C → 3 Section Mentors; Science, Arts and Commerce with 3 sections each → 9. |
| **Pinned post** | An Admin/Section Mentor post shown at the top of the feed for 7 days. |

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
| Posts pinned for 7 days | ✅ (everyone) | ✅ (own section) | ❌ | ❌ |
| Delete any post / comment (moderation) | ✅ | ❌ | ❌ | ❌ |
| React / comment on posts | ✅ | ✅ | ✅ | ✅ |
| Messaging (1-to-1) | ✅ | ✅ | ✅ | ✅ |
| Group chat of session-group | ❌ | ✅ (auto) | ❌ | ✅ (auto) |
| Section chat | ❌ | ✅ (auto) | ✅ (auto, own sections) | ✅ (auto) |
| Manage routine | ✅ | ❌ (view own section) | ❌ (view own) | View |
| Create / conduct online classes | ❌ | ✅ (own courses) | ✅ (own courses) | Attend |
| Add recorded class (YouTube) links | ✅ | ✅ | ✅ (own courses) | Watch |
| Upload notes & study materials | ✅ | ✅ | ✅ (own courses) | View / download |
| Create exams & quizzes | ❌ | ✅ (own courses) | ✅ (own courses) | Take |
| View exam results / progress | ✅ (all) | ✅ (own section) | ✅ (own courses) | Own only |
| Upload previous-year questions | ✅ | ✅ | ✅ (own courses) | View |
| Take / manage attendance | View all | ✅ (own section) | ✅ (own courses) | View own |
| Manage book shop (catalog, purchases) | ✅ | ❌ | ❌ | Buy |
| AI chatbox | ❌ | ❌ | ❌ | ✅ |
| Assign which teacher takes which class, substitute teachers, cancel a class | ✅ | ❌ | ❌ | ❌ |
| Mark students as Passed Out | ✅ | ❌ | ❌ | ❌ |

> "Course Teacher" and "Section Mentor" are not separate account types. They are permissions a **Teacher** account gets through assignments. One teacher can teach several course offerings and also be the Section Mentor of a section. **Everything is decided by the Admin:** who teaches which class, who is the Section Mentor of each section, and the routine.

### 2.2 Admin
- Single super-user. Logs in with **email + password**.
- First login uses a **seed password** set during deployment; the system forces a password change.
- Can reset own password via email.

### 2.3 Teacher
- Account created by Admin with a **User ID and initial password**.
- Gains teaching rights only for course offerings the Admin assigns.
- Can be assigned by the Admin as the **Section Mentor** of a section.

### 2.4 Student
- Account created by Admin **inside a session → group → section** with a **Student ID and initial password**.
- Belongs to exactly one session, one group and one section at any time.
- Automatically enrolled in every course offering of their section.
- Cannot log in after being marked **Passed Out**.

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
3. Inside each group, the Admin creates as many **sections** as needed. Example: *2024–25 → Science* has 150 students, so the Admin creates 3 sections: **Science-A (50)**, **Science-B (50)**, **Science-C (50)**. Arts and Commerce of the same session can have a different number of sections.

```
2024–25
 ├── Science   → Section A (50) · Section B (50) · Section C (50)   = 150 students
 ├── Arts      → Section A (…)
 └── Commerce  → Section A (…) · Section B (…)
2025–26
 ├── Science   → its own sections
 ├── Arts      → its own sections
 └── Commerce  → its own sections
```

### 3.2 Course Catalog
- Admin maintains a master list of **courses**: name, code, group (Science/Commerce/Arts/Common), class (11/12/both), paper (1st/2nd), type (compulsory/optional).
- Example: *Bangla 1st Paper (Common)*, *Physics 2nd Paper (Science)*, *Accounting 1st Paper (Commerce)*.

### 3.3 Assigning Courses & Course Teachers
1. Admin opens **Session → Group → Section**.
2. Clicks **Assign Courses**. The system suggests every catalog course that matches the group and class; Admin ticks the ones to offer.
3. For each selected course, Admin selects the **course teacher** from a dropdown (filtered by the teacher's subjects, but any teacher can be chosen).
4. **Copy assignments** shortcut: copy all course + teacher assignments from one section to another, or from the previous session.
5. Admin can change a course teacher at any time. All existing content (notes, exams, recordings) stays with the course offering; the new teacher takes it over.
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
2. Forced **"Complete Your Profile"** step: verify email (OTP/link), set mobile number, set a new password.
3. Only after this step is the full dashboard unlocked.

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
- **Add:** single form or **bulk CSV import** (students: name, roll, section, class; teachers: name, designation, subjects).
- **Edit:** name, ID, section (move student), designation, subjects, status.
- **Remove:** **Deactivate** is the default (login blocked, data kept). **Permanent delete** requires a confirmation and removes personal data; the user's posts are shown as "Deleted user".
- **Credential slip:** printable/copyable ID + initial password.

### 4.5 Pass-Out Rule
- **Only the Admin closes a session, manually.** The system never closes a session by date or automatically; the Admin decides when a session is finished.
- The Admin's *Sessions* page shows every session with its status (**Active** / **Closed (Passed Out)**), so the Admin always knows which sessions are still running.
- To close, the Admin opens the session and clicks **Close session (Mark Passed Out)** and confirms. The Admin can also mark individual students as Passed Out.
- Passed-out students are automatically logged out and blocked from logging in: *"Your account is inactive because your session has been completed."*
- They are removed from group/section chats; their data is archived and the Admin can view or delete it.

### 4.6 Security Requirements
- Passwords hashed with bcrypt/argon2. They are never stored, and never emailed in plain text after the first issue.
- JWT/session auth with role **and assignment** checks on every API (e.g. a teacher can only edit exams of their own course offerings).
- Reset links expire in 15–30 minutes and are single-use.
- Rate limiting on login, reset, messaging and AI chat.

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
| **Sessions** | Create session (auto-creates 3 groups), promote Class 11 → 12, mark Passed Out, archive. |
| **Sections** | Add / rename / remove sections per group; set capacity; move students between sections. |
| **Courses** | Manage catalog; assign courses + course teachers per section (Section 3.3); copy assignments. |
| **Teachers / Students** | Add, bulk import, edit, deactivate, delete, reset password (Section 4.4). |
| **Section Mentors** | Exactly one per section (e.g. Science-A, Science-B, Science-C → 3); change at any time; auto-joins the section chat and the group chat. |
| **Central Notices** | Section 5.9. |
| **Community** | Create/edit own posts (pinned 7 days), delete any post/comment, review reports, mute a user from posting (temporary). |
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
- Create **posts that are pinned for 7 days** for students of their section.
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

#### 5.7.2 Admin & Section Mentor Pinned Posts
- Admin can **create, edit and delete** posts like any user; Admin can additionally **delete any post or comment**.
- A post created by the **Admin** or a **Section Mentor** is automatically **pinned at the top of the feed for 7 days** from creation:
  - Admin posts are pinned for **everyone**.
  - Section Mentor posts are pinned for **students of that mentor's section**. Everyone else still sees them in the normal feed.
- Pinned posts carry a badge: **"📌 Admin"** or **"📌 Section Mentor · 2024–25 Science-A"**.
- **Feed order:** (1) pinned Admin posts, newest first → (2) pinned Section Mentor posts, newest first → (3) all other posts, newest first.
- After 7 days the post is automatically unpinned and stays in the normal timeline at its original date.
- **If there is no Admin/Section Mentor post in the last 7 days, nothing is pinned**, and the feed starts directly with regular posts.
- Admin can **unpin early** or **extend** a pin. Editing a post does not restart the 7-day timer.
- At most **5 pinned posts** are shown expanded; any more collapse into "Show N more announcements".
- Creating a pinned post sends a notification to its audience.

#### 5.7.3 Moderation
- Admin moderation queue: reported items with reason, reporter count, quick actions (*Dismiss · Delete · Delete & warn · Mute user for N days*).
- Deleted content is soft-deleted (hidden, kept 30 days for audit) and the author is notified.
- Optional automatic filter for a configurable list of banned words (the post is held for review).

### 5.8 Messaging System
- **One-to-one chat:** students ↔ students, teachers ↔ students, Admin ↔ anyone.
- **Group chat** per session-group (all students of the group + the Section Mentors of its sections, auto-joined).
- **Section chat** per section (students + the Section Mentor + course teachers of that section, auto-joined).
- Text, emoji, images, links, PDF attachments.
- Real-time delivery (WebSockets), typing indicator, unread counts, seen status.
- Block / report a user. Admin can review reported conversations only.
- Passed-out students are removed from group/section chats automatically.

### 5.9 Notices

| | **Central Notice** | **Class-wise Notice** |
|---|---|---|
| Published by | Admin | Course teacher / Section Mentor |
| Audience | Entire college, or filter: role / session / group | Selected course offering(s), section(s) or own section (Section Mentor) |
| Content | Title, rich text, attachments (PDF/image), priority (Normal / Important / Urgent) | Same |
| Extras | Show on public landing page (optional), publish now or schedule, expiry date | Publish now or schedule, expiry date |

- Students see a unified **Notices** page with filters (Central / My Classes) and an unread indicator.
- *Important* and *Urgent* notices also trigger an **email**; *Urgent* notices appear as a banner on the dashboard until read.

### 5.10 Notifications
- **In-app notification center** (bell icon with unread count), delivered in real time over WebSockets.
- **Email** for important events (configurable per user, except for urgent notices).
- **Browser push notifications** (Phase 2).

| Event | Student | Teacher |
|---|:-:|:-:|
| New central / class-wise notice | ✅ | ✅ (central) |
| Online class scheduled / starting in 15 min | ✅ | ✅ |
| New recording / notes uploaded in my course | ✅ | – |
| Exam/quiz published, starting soon, result published | ✅ | – |
| New pinned Admin/Section Mentor post | ✅ | ✅ (Admin) |
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
- **Recording:** not done by the portal. If the teacher wants a recording, they record it themselves (e.g. free OBS Studio or phone screen recorder), upload it to YouTube and share the link as a Recorded Class (Section 5.12).

### 5.12 Free Recorded Classes
- **The portal does not record or store videos.** The teacher records the class themselves, uploads it to **YouTube** (Unlisted recommended) and shares the link in the portal.
- Teachers (own courses), Section Mentors and the Admin add a recorded class with: title, course, chapter/topic, description and the **YouTube link** (a Google Drive link is also accepted).
- As soon as the link is saved, the video appears automatically for the students of that course in an embedded YouTube player; students get a notification.
- **Visibility:** *My section only* or *Free for all students* (college-wide free library).
- Students browse by course → chapter, search, and watch in an embedded player. "Watched" progress is shown per video.
- Replaces the "Previous Class Links" feature from v1.0.

### 5.13 Notes & Study Materials
- Teachers upload notes for their course offering: title, chapter, description, files (PDF, DOC/DOCX, PPT, images) or links.
- Organized by course → chapter; students view in the browser or download.
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
- **Settings:** start & end window, duration (timer), total marks, pass marks, negative marking (optional), shuffle questions/options, number of attempts, show correct answers after submission (yes/no), result publish mode (instantly / manually).
- **Reports:** score distribution, highest/average/lowest, per-question correctness, list of students who did not attend. Export as CSV/PDF.

#### 5.14.2 Student: Taking an Exam
- Students see upcoming, live and completed exams for their courses.
- During the exam: countdown timer, question navigator, "mark for review", **auto-save** every answer, auto-submit when time ends.
- If the connection drops, the student can resume within the window with the remaining time.
- **Integrity measures:** one active session per student, tab-switch/fullscreen-exit events logged and shown to the teacher, randomized order. (A web exam cannot fully prevent cheating; these measures discourage and record it.)

### 5.15 Exam Progress
- **Student view:**
  - List of all results by course: marks, percentage, grade (configurable HSC grading scale: A+, A, A-, B, C, D, F), and **rank**.
  - **Ranks are always shown to students:** rank in section and rank in the whole group (session-group) for every exam/quiz, plus an overall rank per course. Students with equal marks share the same rank (e.g. 1, 2, 2, 4).
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
- **Only the Admin can create or change the routine.** Section Mentors and teachers can only view it.
- This routine is what drives attendance: every routine slot becomes a class the teacher takes attendance for (Section 5.18).
- **Conflict check:** warns if a teacher is double-booked in two sections at the same time.
- **Student view:** weekly grid + "today" list; current/next class highlighted.
- **Teacher view:** their personal weekly routine, built automatically from all sections they teach.
- Alternative: upload the routine as an image/PDF (kept from v1.0) for quick use.
- Changes to the routine notify affected students and teachers.

### 5.18 Attendance (Per Period)

#### 5.18.1 How Attendance Is Organized
- **Most attendance is taken by teachers in the physical classroom.** The teacher goes to the class, opens the attendance sheet on their phone or laptop and marks the students. Online classes (5.11) also have attendance, but they are the smaller case.
- Attendance is taken **per class period**, not per day.
- Every **routine slot** (e.g. *Sunday 10:00 · Physics 1st · Science-A · Mr. Rahman*) automatically generates a **Class Meeting** for each date it occurs. Online classes (5.11) are also Class Meetings.
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
- Cancelled meetings are not counted.
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
- **Admin:** purchase list with filters (book, student, date), most-unlocked books report.
- Free book PDFs from v1.0 remain available under **Notes & Materials**.

### 5.20 AI Chatbox (Student Study Assistant)
- A chat assistant for **students only**, available from the menu and as a floating button.
- **Purpose:** explain concepts, solve and explain problems step by step, summarize topics, generate practice questions, and help with English/Bangla writing. It is scoped to academic help, and off-topic or harmful requests are politely declined.
- **Zero cost: powered by the free tier of the Google Gemini API** (API key created free at Google AI Studio, no credit card). Use the fast, light **Gemini "Flash" / "Flash-Lite"** model that is on the free tier at build time; the model name is a setting so it can be changed without code changes.
- **Free-tier limits to plan around:** Google caps free requests per minute and per day for the whole project (not per student), and the exact numbers change from time to time (check AI Studio before launch). So:
  - Admin sets a **daily message limit per student** (e.g. 15–20) so a few students cannot use up the whole day's quota.
  - When the free quota is used up, students see *"The AI assistant is busy, please try again later"* instead of an error.
  - On the free tier Google may use the messages to improve its products, so the portal **never sends personal data** (name, ID, phone) to the AI, only the student's question.
- **Backup free option:** the provider is configurable, so a second free API (e.g. Groq's free tier) can be switched on if Gemini's free quota is not enough.
- Students can start new chats, see past chats, and write in **Bangla or English**. Supports formatted math/code in answers.
- **Safety:** server-side calls only (key never exposed), no access to other students' data, disclaimer "AI may make mistakes, verify with your teacher".
- **During a live exam, the AI chatbox is disabled** for students taking that exam.
- **Phase 2:** answers grounded in the college's own uploaded notes (course-aware assistant).

---

## 6. Data Model (High Level)

| Entity | Key Fields |
|---|---|
| **User** | id, login_id, email, mobile, password_hash, role (admin/teacher/student), status (active/inactive/passed_out/deleted), first_login, avatar_url |
| **StudentProfile** | user_id, name, session_id, group_id, section_id, class (11/12), roll, bio, dob, address, guardian_contact |
| **TeacherProfile** | user_id, name, designation, subjects[], bio |
| **Session** | id, name, status, created_at |
| **Group** | id, session_id, type (science/commerce/arts) |
| **Section** | id, group_id, name (A/B…), capacity, mentor_teacher_id |
| **Course** | id, code, name, group_type, class, paper, is_optional |
| **CourseOffering** | id, section_id, course_id, teacher_id, created_at |
| **Enrollment** | course_offering_id, student_id (for optional courses) |
| **RoutineSlot** | id, section_id, day, start_time, end_time, course_offering_id, room |
| **Post** | id, author_id, text, tag, pinned_until, pin_audience (all/group_id), status, created_at |
| **PostMedia** | id, post_id, url, type |
| **Reaction / Comment / Report** | post or comment ref, user_id, type/text/reason |
| **Conversation / Member / Message** | type (direct/group/section), ref_id; members; sender, text, attachment, seen_at |
| **Notice** | id, author_id, scope (central/class), audience_json, title, body, priority, attachments, publish_at, expires_at |
| **Notification** | id, user_id, type, ref, text, read_at, created_at |
| **OnlineClass** | id, course_offering_id, title, start_at, duration, platform (meet/jitsi/other), join_url, status |
| **OnlineClassJoin** | online_class_id, student_id, clicked_join_at |
| **RecordedClass** | id, course_offering_id / course_id, chapter, title, video_source (youtube/drive), url, visibility |
| **Material** | id, course_offering_id / scope, chapter, title, file_url, type |
| **Question (bank)** | id, teacher_id, course_id, type, text, options_json, correct_json, marks, chapter_tag |
| **Exam** | id, course_offering_id, kind (exam/quiz), title, start_at, end_at, duration, total_marks, pass_marks, settings_json, status |
| **ExamQuestion** | exam_id, question_id, order, marks |
| **ExamAttempt** | id, exam_id, student_id, started_at, submitted_at, score, status, integrity_log |
| **Answer** | attempt_id, question_id, selected_option_ids, is_correct, marks_awarded |
| **PreviousQuestion** | id, course_id, year, exam_type, board, file_url, solution_url |
| **ClassMeeting** | id, routine_slot_id / online_class_id, date, start_time, course_offering_ids[], teacher_id, substitute_teacher_id, status (scheduled/held/cancelled) |
| **AttendanceRecord** | id, class_meeting_id, student_id, status (present/absent/late/excused), marked_by, marked_at |
| **AttendanceEdit** | id, attendance_record_id, old_status, new_status, edited_by, edited_at |
| **Book** | id, title, author, publisher, course_id, price, cover_url, pdf_url, preview_pages |
| **BookPurchase** | id, student_id, book_id, price, payment_status (unlocked_no_gateway), purchased_at |
| **AIConversation / AIMessage** | id, student_id, title; conversation_id, role, content, tokens, created_at |
| **Token (reset / verify)** | user_id, token_hash, purpose, expires_at, used |

---

## 7. Key User Flows

**Flow A – Admin sets up a new session**
Create session "2025–26" → Science/Commerce/Arts auto-created → add sections (Science-A, Science-B…) → assign courses + course teachers per section (or copy from last session) → assign Section Mentors → bulk-import students into sections → credentials generated and shared.

**Flow B – Student first login**
Login with ID + password → complete profile (email, mobile, new password) → dashboard with pinned posts, today's routine, upcoming exams → auto-member of group and section chats.

**Flow C – Admin pinned post**
Admin → Feed → *Create post* → published → pinned at top for all users for 7 days with 📌 Admin badge → everyone notified → day 8: auto-unpinned and stays in the timeline.

**Flow D – Teacher runs a live class**
Teacher creates a free Google Meet link → My Courses → *Physics 1st – Science A* → Classes → *Schedule* (Sun 10:00) and pastes the link → students notified → students click *Join* (opens Meet in a new tab, click logged) → class ends → teacher reviews pre-filled attendance → later the teacher uploads their own recording to YouTube and adds the link under Recordings → students see it automatically.

**Flow E – Online exam**
Teacher creates exam (30 MCQ, 40 min, window Mon 8–10 PM) → students notified → student starts, answers auto-saved, auto-submit at time-up → all answers auto-graded instantly → teacher clicks *Publish results* (or results publish automatically) → students notified → Progress page updated.

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
| **Security** | HTTPS everywhere, role + assignment-based authorization, input sanitization (XSS), file-type and size validation on uploads, signed URLs for private files, audit log for Admin actions. |
| **Privacy** | Students' personal details (mobile, address, guardian) visible only to the student, their teachers and the Admin. |
| **Backups** | Daily automatic database backups, kept 30 days; file storage with versioning. |
| **Language** | UI in English; Bangla content supported everywhere (Unicode); Bangla UI can be added later. |
| **Accessibility** | Readable fonts, sufficient contrast, keyboard navigation for forms and exams. |

---

## 9. Recommended Technical Architecture *(proposal, to be confirmed)*

| Layer | Recommendation |
|---|---|
| **Frontend** | Next.js (React) + Tailwind CSS; responsive, PWA-enabled. |
| **Backend API** | Node.js (NestJS or Express) REST API, with Socket.IO for chat and notifications. |
| **Database** | PostgreSQL; Redis for sessions, caching, rate limits and the real-time pub/sub. |
| **File storage** | S3-compatible object storage (AWS S3 / Cloudflare R2 / DigitalOcean Spaces) for images and PDFs (no videos). |
| **Live classes** | No integration: teacher pastes a free Google Meet or Jitsi Meet link. |
| **Recorded video** | Teacher's own YouTube (unlisted) link, shown in an embedded player. No video upload. |
| **Email** | SMTP (client-provided) with a background job queue. |
| **Payments** | None in this version (placeholder **Pay** button). A gateway can be plugged in later. |
| **AI** | Google Gemini API free tier (Flash / Flash-Lite), called server-side only; provider configurable. |
| **Hosting** | VPS or cloud (e.g. DigitalOcean / AWS) with Docker; daily backups. |

---

## 10. Release Plan (Phases)

| Phase | Features |
|---|---|
| **Phase 1 – Core** | Auth & accounts, sessions/groups/sections, course & teacher assignment, separate dashboards, profile, community feed with pinned posts & moderation, messaging, central & class-wise notices, in-app notifications, routine. |
| **Phase 2 – Learning** | Online classes, recorded classes, notes & materials, previous-year questions, online exams & quizzes, exam progress, attendance, Student 360° view. |
| **Phase 3 – Extras** | Digital book shop (placeholder Pay button), free AI chatbox, email/push notifications, reports & exports, AI grounded in college notes. |

---

## 11. Decisions & Open Questions

**Confirmed by the client (13 Nov 2026):**
1. "Seasons" means academic **sessions** of HSC students, e.g. 2024–25, 2025–26, 2027–28.
2. The Admin creates sessions; each new session automatically gets its own 3 groups (**Science, Arts, Commerce**); each group is split into one or more **sections** by the Admin, e.g. 150 Science students → Science-A, B, C with 50 each (Section 3.1).
3. Section Mentor posts are pinned only for students of their own section; Admin posts are pinned for everyone.
4. Admin can edit **own** posts and delete **any** post; Admin does not edit other users' posts.
5. Book shop sells **digital PDF books only**. No printed books, delivery or cash on delivery (Section 5.19).
6. **No payment gateway** in this version: the **Pay** button unlocks the PDF immediately (Section 5.19).
7. **Recorded classes:** the portal does not record. Teachers record themselves, upload to YouTube and share the link; students see it automatically (Section 5.12).
8. **Live classes** must cost nothing: teachers use free Google Meet or Jitsi Meet links (Section 5.11).
9. **AI chatbox** must cost nothing: free Google Gemini API tier with per-student daily limits (Section 5.20).
10. **Exam ranks are shown to students** (Section 5.15).
11. **Sessions are closed only by the Admin, manually** (never automatically). The Admin sees each session's status (Active / Closed) on the Sessions page (Section 4.5).

12. **Online exams and quizzes are text-based MCQ only**, all auto-graded. No written answers and no file/image uploads (Section 5.14).
13. Requirement numbers 14, 15, 16 and 23 were **removed by the client on purpose**. No features are missing.
14. **Google Meet's 60-minute limit on free calls is acceptable** for live classes.

**Open questions:** none at this time.
