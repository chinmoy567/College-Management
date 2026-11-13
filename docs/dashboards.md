# Dashboards and News Feed: What Each Screen Shows

Summary of `PRD.md` §5.2–5.7. If this file and `PRD.md` disagree, `PRD.md` wins. The PRD does not fix the visual layout (card placement, colors, spacing); that is decided during design. All screens are phone-first (360 px), with a bottom tab bar or drawer on phones.

## 1. Admin dashboard (PRD §5.2.1, §5.3)

**Stats cards:** active sessions, students, teachers, sections, today's posts, books purchased this month, reported posts.

**Quick actions:** create session, add student/teacher, assign courses, publish central notice, create pinned post.

**Alerts:** sections with unassigned courses; reported content.

**Charts:** students per group, exam participation, book purchases (monthly).

**Menu:** Sessions & Sections, Courses, Teachers, Students, Section Mentors, Notices, Community Moderation, Book Shop, Previous Questions, Recorded Classes, Reports, Settings.

**Admin panel functions**

| Area | Functions |
|---|---|
| Sessions | Create session (auto-creates 3 groups), move students Class 11 → 12, mark Passed Out, archive |
| Sections | Add/rename/remove sections per group (max 30 students each); move students between sections |
| Courses | Manage catalog; assign courses and course teachers per section; copy assignments |
| Schedule Manager | Routine, periods, rooms, holidays, special days, single-class changes, calendar view |
| Teachers / Students | Add, bulk import, edit, deactivate, delete, reset password |
| Section Mentors | Exactly one per section; changeable any time; auto-joins section chat and group chat |
| Central Notices | PRD §5.9 |
| Community | Create/edit own posts (pinned by default), delete any post/comment, review reports, temporary mute |
| Book Shop | PRD §5.19 |
| Previous Questions / Recorded Classes | College-wide uploads |
| Reports | Export students, results, attendance, book purchases as CSV/PDF |
| Student 360° | One-click full view of any student |

**Student 360° view (Admin only)**
- Opened by searching Student ID, name, roll or phone, or by clicking any student's name/photo anywhere.
- Tabs: Overview, Academic, Attendance, Exams & Progress, Community, Book Shop, Activity Log.
- Quick actions on the page: reset password, deactivate/reactivate, move section, send message, warn/mute, delete a post or comment.
- Export the full report as PDF.
- Teachers and Section Mentors do not get this view.

## 2. Teacher dashboard (PRD §5.2.2, §5.5)

**Today:** today's classes from the routine; upcoming online classes with an **Open meeting** button; exams running now.

**My Courses:** one card per course offering (section, student count). Each opens a course workspace with tabs: Classes, Recordings, Notes, Exams & Quizzes, Results, Notices, Attendance, Students.

**Pending work:** exam results waiting to be published; unread messages.

**Menu:** Dashboard, My Courses, Routine, Feed, Messages, Notifications, Profile.

**Rules:** everything works only within the teacher's assigned course offerings.

## 3. Section Mentor dashboard (PRD §5.2.2, §5.4)

A Section Mentor is a teacher in charge of exactly one section. They get the full Teacher dashboard plus a **Section Mentor area**:
- Section overview and the section's students and course offerings.
- Section routine (view only).
- Section notices and pinned posts.
- Monitoring: exam results, attendance summaries, inactive students.
- Message any student; post announcements in the section chat.
- Cannot assign teachers or substitutes, cancel classes or change the routine (Admin only).

## 4. Student dashboard (PRD §5.2.3, §5.6)

**Top:** pinned posts from the Admin or Section Mentor, shown until the student has seen each one once (max 7 days).

**Widgets:**
- Today's routine and next class; **Join** button when a class is live.
- Upcoming exams/quizzes with countdown.
- Latest notices (central + class-wise).
- Attendance summary (% per course).
- Recent results.

**Menu:** Home/Feed, My Courses, Live Classes, Recorded Classes, Notes, Exams, Progress, Previous Questions, Routine, Attendance, Notices, Messages, Book Shop, AI Assistant, Profile.

**My Courses:** every course offering of the student's section with teacher name; tabs: Live Classes, Recordings, Notes, Exams, Results, Notices, Previous Questions.

**Profile:** picture, name (Admin can lock), Student ID / session / class / group / section (read-only), email (with verification), mobile, bio, DOB, address, guardian contact.

## 5. News feed / Community (PRD §5.7)

**Visibility:** college-wide; every active student, teacher and the Admin sees every post.

**Posts:** text (required), up to 10 images, optional link or PDF, optional tag (General, Problem / Need Help, Study, Event). Edit/delete own posts ("edited" label shown).

**Reactions:** Like, Love, Haha, Wow, Sad, Angry. One per user per post; can change or remove.

**Comments:** text, links, images, PDF; one level of replies; comment count shown; edit/delete own.

**Author line on every post and comment**
- Student: photo, name, session · group · section.
- Teacher: "Teacher", plus "Section Mentor · session Group-Section" if they mentor.
- Admin: "Admin".

**Public profile** (any logged-in user): photo, name, role, session/group/section/class (students), courses taught (teachers), bio, recent posts. Never shows email, mobile, address, DOB, guardian info or Student ID. Inactive (passed-out/deactivated) users show only photo, name and "This account is no longer active." Deleted users appear as "Deleted user".

**Pinned posts**
- Created by the Admin (pinned for everyone) or a Section Mentor (pinned for their section's students). The "Pin this post" switch is on by default and can only be chosen at creation.
- A pin stays at the top for each user until that user has seen it once. "Seen" = at least half the post visible for at least 1 second. One view record covers both feed and dashboard.
- A pin lasts at most 7 days from creation; the post then stays in the normal timeline.
- Badge: "📌 Admin" or "📌 Section Mentor · session Group-Section".
- At most 5 pinned posts shown expanded; extra ones collapse under "Show N more announcements".
- Admin can unpin early or extend (extending only helps users who have not seen it). Editing does not restart the timer or re-pin.
- Creating a pinned post notifies its audience.

**Feed order**
1. Unseen pinned Admin posts, newest first.
2. Unseen pinned Section Mentor posts, newest first.
3. All other posts, newest first.

If there is no unseen pinned post from the last 7 days, nothing is pinned.

**Moderation**
- Users can report a post/comment with a reason.
- Admin queue shows reason and reporter count; actions: Dismiss, Delete, Delete & warn, Mute user for N days.
- Deleted content is soft-deleted (hidden, kept 30 days) and the author is notified.
- Mute blocks posts, comments and chat messages until it ends; the user can still read. Warn only notifies.
- Optional banned-word filter holds matching posts for review.
