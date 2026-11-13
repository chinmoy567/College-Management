# Product Requirements Document (PRD)
## College Management System (CMS)

| Item | Detail |
|---|---|
| **Document Version** | 1.0 |
| **Date** | 13 November 2026 |
| **Product Type** | Web-based College Management & Student Community Portal |
| **Target Institution** | Higher Secondary College (Class 11 & 12 – HSC) |
| **User Roles** | Admin, Teacher (incl. Batch Coordinator), Student |

---

## 1. Overview

### 1.1 Purpose
The College Management System is a web portal that lets a college manage academic sessions, teachers and students in one place, while also giving students a private, Facebook-style community to post, react, comment and message each other. The Admin controls all accounts; teachers act as Batch Coordinators who guide their groups and share study materials; students access their routine, class recordings, books and community feed.

### 1.2 Goals
1. Centralize session, group, teacher and student management under one Admin.
2. Provide secure, role-based login with admin-issued credentials and email-based password reset.
3. Give every student a profile, routine, previous class links (subject-wise) and downloadable book PDFs.
4. Build an internal social space: posts, reactions, comments and one-to-one / group messaging.
5. Automatically remove access for students once they pass out.


---

## 2. User Roles & Access

| Feature | Admin | Batch Coordinator (Teacher) | Teacher | Student |
|---|:-:|:-:|:-:|:-:|
| Login with email + password | ✅ | ✅ | ✅ | ✅ |
| Create / edit sessions & groups | ✅ | ❌ | ❌ | ❌ |
| Create teacher accounts (ID + password) | ✅ | ❌ | ❌ | ❌ |
| Create student accounts (ID + password) | ✅ | ❌ | ❌ | ❌ |
| Assign Batch Coordinator to a group | ✅ | ❌ | ❌ | ❌ |
| Upload routine, class links, book PDFs | ✅ | ✅ (own group) | ❌ | ❌ |
| Message students | ✅ | ✅ | ✅ | ✅ |
| Group chat of own session-group | ❌ | ✅ (auto-joined) | ❌ | ✅ (auto-joined) |
| Create posts / react / comment | ❌ | ✅ | ✅ | ✅ |
| Edit own profile & image | ✅ | ✅ | ✅ | ✅ |
| Mark students as Passed Out | ✅ | ❌ | ❌ | ❌ |

### 2.1 Admin
- Single super-user. Logs in with **email + password**.
- First login uses a **seed password** (set during deployment). The system forces a password change on first login.
- After that, logs in with own email and new password; can reset password via email.

### 2.2 Teacher
- Account created by Admin with a **User ID and initial password** chosen by Admin.
- Can be assigned as **Batch Coordinator** of one or more session-groups.

### 2.3 Student
- Account created by Admin **inside a session and group** with a **Student ID and initial password**.
- Belongs to exactly one session (e.g. 2024–25) and one group (Science / Commerce / Arts).
- Cannot log in after being marked **Passed Out**.

---

## 3. Authentication & Account Lifecycle

### 3.1 Login Flow
1. User opens Landing Page → clicks **Login**.
2. Selects role (Admin / Teacher / Student) or system detects it from the ID.
3. Enters **User ID or Email** + **Password**.
4. On success, redirected to their role-specific dashboard.

### 3.2 First-Time Login (Teacher & Student)
1. Logs in with admin-given User ID and password.
2. System forces a **"Complete Your Profile"** step:
   - Set **email address** (verified by OTP/link).
   - Set **mobile number**.
   - Set a **new password** (replaces admin-given password).
3. Only after this step is the full dashboard unlocked.

### 3.3 Password & Email Management
| Action | How it works |
|---|---|
| **Forgot password** | User enters registered email → system sends reset link/OTP via SMTP → user sets new password. |
| **Change password** | From Profile, with current password. |
| **Change email** | From Profile → verification link sent to the new email → confirmed → updated. |
| **Admin reset** | Admin can edit any teacher/student ID or reset their password at any time. |
| **Auto-generate password** | Admin can click "Generate" to create a strong random password when creating accounts. |

**SMTP:** Configured via environment variables (host, port, user, password, sender). Credentials will be provided by the client later.

### 3.4 Pass-Out Rule
- Admin marks a whole session (or individual students) as **Passed Out**.
- Passed-out students are **automatically logged out** and **blocked from logging in**. Login shows: *"Your account is inactive because your session has been completed."*
- Their data (posts, messages) is kept archived; Admin can view or delete it.

### 3.5 Security Requirements
- Passwords hashed (bcrypt/argon2); never stored or emailed in plain text after first issue.
- JWT/session-based auth with role checks on every API.
- Reset links expire in 15–30 minutes and are single-use.
- Rate-limit login and reset attempts.

---

## 4. Functional Requirements

### 4.1 Landing Page (Public)
- College name, logo, banner, short introduction.
- Sections: About, Departments (Science / Commerce / Arts), Notices (optional), Contact.
- **Login** button (top-right) leading to the login page.

### 4.2 Admin Panel

#### 4.2.1 Session Management
- Create a session, e.g. **"2024–25"**.
- When a session is created, **three groups are auto-created**: **Science, Commerce, Arts**.
- Each session-group is independent (e.g. *2024–25 Science* is different from *2025–26 Science*).
- Session status: **Active** (Class 11 / Class 12) → **Passed Out**.
- Edit / archive sessions.

#### 4.2.2 Student Management
- Inside a session-group → **Add Student**: name, roll, class (11 / 12), group.
- System creates **Student ID + password** (manual or auto-generated).
- Admin shares the credentials with the student (printable slip / copy button).
- Bulk add via CSV upload (recommended).
- Edit, deactivate, move to another group, reset password.
- Promote session from Class 11 → Class 12; mark Passed Out.

#### 4.2.3 Teacher Management
- Add teacher: name, designation, subject(s), **User ID + password**.
- Edit, deactivate, reset password.

#### 4.2.4 Batch Coordinator Assignment
- For each session-group, Admin selects **one teacher** as **Batch Coordinator**.
- On assignment, the teacher is **auto-added to that group's chat**.
- Admin can change the coordinator at any time.

#### 4.2.5 Admin Dashboard
- Counts: active sessions, students, teachers, posts.
- Quick links: create session, add student, add teacher.
- Moderation: view/delete reported posts or comments.

### 4.3 Batch Coordinator Panel (Teacher)
- View all students in assigned session-group(s).
- Upload and manage for their group:
  - **Class Routine** (table or image/PDF).
  - **Previous Class Links**, organized **subject-wise** (e.g. YouTube / Drive / Meet recordings).
  - **Book PDFs** and other study materials, subject-wise.
- Post announcements in the group chat.
- Message any student individually.

### 4.4 Student Portal

#### 4.4.1 Dashboard (Home Feed)
- After login, student sees the **College Feed**: all posts from **all students across all sessions and groups** (Class 11 sees Class 12, Science sees Arts, etc.).
- Newest first, infinite scroll.
- Left/side menu: Feed, Messages, Routine, Class Links, Books, Profile.

#### 4.4.2 Profile
| Field | Editable by Student? |
|---|:-:|
| Profile picture (image upload) | ✅ |
| Full name | ✅ (Admin can lock) |
| Student ID | ❌ |
| Session (e.g. 2024–25) | ❌ |
| Class (11 / 12) | ❌ |
| Group (Science / Commerce / Arts) | ❌ |
| Email | ✅ (with verification) |
| Mobile number | ✅ |
| Extra info (bio, date of birth, address, guardian contact) | ✅ |

Teachers have a similar profile (picture, name, designation, subjects, email, mobile, bio).

#### 4.4.3 Routine
- View the class routine uploaded by the Batch Coordinator for the student's session-group.

#### 4.4.4 Previous Classes
- List of past class links, **filtered by subject**, with date and title.

#### 4.4.5 Books & Materials
- Subject-wise list of **book PDFs**; view in browser or **download**.

### 4.5 Community: Posts, Reactions & Comments
- **Create post:** text (required), optional image, link, or PDF attachment.
- **Reactions** (Facebook-style): 👍 Like, ❤️ Love, 😆 Haha, 😮 Wow, 😢 Sad, 😡 Angry. One reaction per user per post; can change/remove.
- **Comments:** text, **links**, and **PDF attachments**. Comment count shown on post.
- Edit / delete own post or comment.
- **Report** post/comment → goes to Admin moderation.
- Visibility: every active student and teacher in the college can see every post.

### 4.6 Messaging
- **One-to-one chat:** any student can message any other student; teachers and coordinators can message students.
- **Group chat:** one auto-created chat per **session-group** (e.g. *2024–25 Science*). All students of that group and its Batch Coordinator are **auto-joined**; new students added later are auto-joined too.
- Supports **text, links and PDF** attachments.
- Real-time delivery (WebSockets), unread counts, seen status.
- Passed-out students are removed from group chats automatically.

---

## 5. Data Model (High Level)

| Entity | Key Fields |
|---|---|
| **User** | id, user_id (login ID), email, mobile, password_hash, role (admin/teacher/student), status (active/inactive/passed_out), first_login (bool), avatar_url |
| **StudentProfile** | user_id, name, session_id, group_id, class (11/12), roll, bio, dob, address, guardian_contact |
| **TeacherProfile** | user_id, name, designation, subjects, bio |
| **Session** | id, name ("2024–25"), status (active/passed_out), created_at |
| **Group** | id, session_id, type (science/commerce/arts), coordinator_teacher_id |
| **Routine** | id, group_id, file_url / table_json, updated_by |
| **ClassLink** | id, group_id, subject, title, url, class_date |
| **Material (Book)** | id, group_id, subject, title, pdf_url |
| **Post** | id, author_id, text, attachment_url, attachment_type, created_at |
| **Reaction** | id, post_id, user_id, type |
| **Comment** | id, post_id, author_id, text, attachment_url |
| **Conversation** | id, type (direct/group), group_id (nullable) |
| **ConversationMember** | conversation_id, user_id |
| **Message** | id, conversation_id, sender_id, text, attachment_url, seen_at |
| **PasswordReset / EmailVerify Token** | user_id, token_hash, expires_at, used |

---

## 6. Key User Flows

**Flow A – Admin onboards a new session**
Admin login → Sessions → *Create "2024–25"* → Science/Commerce/Arts auto-created → assign Batch Coordinator for each → Add students (manual/CSV) → credentials generated → shared with students.

**Flow B – Student first login**
Student receives ID + password → Login → forced profile setup (email verification, mobile, new password) → Dashboard feed unlocked → auto-member of group chat.

**Flow C – Forgot password**
Login page → *Forgot Password* → enter email → reset link via SMTP → set new password → login.

**Flow D – Coordinator shares material**
Teacher login → My Groups → *2024–25 Science* → Books → Upload PDF (subject: Physics) → visible to all students of that group.

**Flow E – Session passes out**
Admin → Sessions → *2023–24* → *Mark Passed Out* → all students logged out, login blocked, removed from group chat; data archived.

