# Architecture: College Management System

The full architecture of the system, shown in diagrams.
**Order of authority:** `docs/PRD.md` → `docs/spec/*` → this document. If a diagram here disagrees with the PRD or a spec, the PRD/spec wins and this file is fixed.
Related: `docs/tech.stack.md` (libraries, hosting), `docs/spec/` (buildable details), `docs/implementation/` (build plans).

Diagrams use **Mermaid**, which GitHub and VS Code (with a Mermaid preview extension) render directly.

## Contents

1. [Architecture at a glance](#1-architecture-at-a-glance)
2. [System context](#2-system-context)
3. [Deployment](#3-deployment)
4. [Inside the Node process](#4-inside-the-node-process)
5. [Repository and code structure](#5-repository-and-code-structure)
6. [Backend modules](#6-backend-modules)
7. [Request pipeline](#7-request-pipeline)
8. [Roles and permissions](#8-roles-and-permissions)
9. [Academic structure](#9-academic-structure)
10. [Data model](#10-data-model)
11. [Authentication and sessions](#11-authentication-and-sessions)
12. [Account lifecycle](#12-account-lifecycle)
13. [Schedule, Class Meetings and attendance](#13-schedule-class-meetings-and-attendance)
14. [Exams and quizzes](#14-exams-and-quizzes)
15. [Community feed and pinned posts](#15-community-feed-and-pinned-posts)
16. [Real-time chat](#16-real-time-chat)
17. [Notices, notifications, email and push](#17-notices-notifications-email-and-push)
18. [Learning content and online classes](#18-learning-content-and-online-classes)
19. [File storage](#19-file-storage)
20. [Book shop](#20-book-shop)
21. [AI study assistant](#21-ai-study-assistant)
22. [Background jobs](#22-background-jobs)
23. [Security architecture](#23-security-architecture)
24. [Frontend architecture](#24-frontend-architecture)
25. [CI/CD and environments](#25-cicd-and-environments)
26. [Quality attributes and how the design meets them](#26-quality-attributes-and-how-the-design-meets-them)
27. [Key architecture decisions](#27-key-architecture-decisions)

---

## 1. Architecture at a glance

| Aspect | Choice |
|---|---|
| Style | **Modular monolith**: one repo, one Node process, one database. Modules are split by feature (`auth`, `academics`, `exams`, …) with strict boundaries. |
| Frontend | Next.js (App Router) + Tailwind + shadcn/ui, phone-first (360 px). Talks **only** to the Express API. |
| Backend | Express + Socket.IO + pg-boss, TypeScript. All business rules and permission checks live here. |
| Data | PostgreSQL on Supabase via Prisma. Sessions, rate limits and the job queue also live in PostgreSQL. **No Redis.** |
| Files | Supabase Storage: `private` bucket (signed URLs) and a small `public` bucket. |
| External | Gmail SMTP (email), Groq (AI), Google Meet / Jitsi (live class links), YouTube / Google Drive (recordings). |
| Hosting | Render free web service + Supabase free plan. Cost: **zero**. |
| Users | ~3,000 users, ~500 concurrent exam takers, ~95% on phones. One Admin, teachers, students (some under 18). |

---

## 2. System context

Who uses the system and which outside services it talks to.

```mermaid
flowchart LR
    admin(["Admin<br/>(one account)"])
    teacher(["Teachers<br/>incl. Section Mentors"])
    student(["Students<br/>Class 11-12"])
    visitor(["Public visitor"])

    cms["College Management System<br/>web app + API"]

    smtp["Gmail SMTP<br/>auth and notice emails"]
    groq["Groq API<br/>AI study assistant"]
    meet["Google Meet / Jitsi<br/>live class links"]
    yt["YouTube / Google Drive<br/>recorded classes"]
    push["Browser push services<br/>Web Push"]
    uptime["UptimeRobot / cron-job.org<br/>pings health every 10 min"]

    admin -->|HTTPS| cms
    teacher -->|HTTPS| cms
    student -->|HTTPS| cms
    visitor -->|landing page| cms

    cms -->|SMTP| smtp
    cms -->|HTTPS, server-side only| groq
    cms -->|Web Push VAPID| push
    teacher -.->|creates link| meet
    student -.->|opens link in new tab| meet
    teacher -.->|uploads own video| yt
    student -.->|embedded player| yt
    uptime -->|GET /api/health| cms
```

There is **no** integration with Meet, Jitsi or YouTube: teachers paste links; the app stores and shows them.

---

## 3. Deployment

One free Render web service runs everything. Supabase holds the database and files.

```mermaid
flowchart TB
    subgraph client["User devices (mostly phones)"]
        browser["Browser / installed PWA<br/>Next.js pages + service worker"]
    end

    subgraph render["Render free web service (one Node process)"]
        express["Express server<br/>/api routes"]
        sio["Socket.IO<br/>/socket.io"]
        boss["pg-boss workers<br/>background jobs"]
        next["Next.js request handler<br/>all other paths"]
    end

    subgraph supabase["Supabase free plan (Mumbai / Singapore)"]
        pooler["Session pooler :5432<br/>DATABASE_URL"]
        direct["Direct connection<br/>DIRECT_URL, migrations only"]
        pg[("PostgreSQL<br/>data, sessions, rate limits,<br/>pgboss schema")]
        storage[("Storage<br/>public + private buckets")]
        pooler --> pg
        direct --> pg
    end

    subgraph ext["External free services"]
        smtp["Gmail SMTP"]
        groq["Groq API"]
        pushsvc["Push services"]
    end

    github["GitHub repo"] -->|deploy on push to main| render
    browser -->|"HTTPS cms-demo.onrender.com"| express
    browser -->|WebSocket same origin| sio
    browser -->|signed URL, direct download| storage
    express --> next
    express --> pooler
    boss --> pooler
    express -->|service_role key| storage
    boss --> smtp
    express --> groq
    boss --> pushsvc
    monitor["Uptime monitor"] -->|every 10 min| express
```

Notes:
- **One address, one cookie:** Express hands every non-API request to Next.js, so the session cookie is first-party and there is no CORS.
- **Files never pass through Express on download:** the browser fetches them from Supabase with a short-lived signed URL (saves RAM on the free plan).
- **Keep-awake:** the uptime monitor stops Render from sleeping and Supabase from pausing. If Render does sleep, jobs run late but stay correct (Section 22).
- **Later (real launch, still free):** the same app in Docker on an Oracle Cloud Always Free VM with Caddy for HTTPS; files can stay on Supabase.

---

## 4. Inside the Node process

```mermaid
flowchart TB
    http["Node http.Server :PORT"]
    http --> app["Express app"]
    http --> io["Socket.IO server"]

    subgraph pipeline["Express pipeline"]
        helmet["helmet + CSP nonce"] --> reqid["request id + pino-http"]
        reqid --> json["express.json 1 MB"]
        json --> router{"path starts<br/>with /api?"}
    end
    app --> helmet

    router -->|yes| api["/api router<br/>public routes, then auth chain, then modules"]
    router -->|no| nextH["Next.js handler<br/>pages, assets"]

    api --> services["Module services<br/>business rules"]
    io --> rt["realtime handlers<br/>socket auth, rooms, events"]
    rt --> services

    services --> prisma["PrismaClient<br/>single instance"]
    services --> storageLib["lib/storage.ts"]
    services --> notifyLib["notify()"]
    services --> enqueue["boss.send()"]

    subgraph jobs["pg-boss workers (same process)"]
        w1["meetings.generate"]
        w2["exam.auto_submit / close_check / regrade"]
        w3["email.send / push.send"]
        w4["notice.publish"]
        w5["book.make_preview / material.extract_text"]
        w6["storage.purge / housekeeping"]
    end
    enqueue --> jobs
    jobs --> services

    notifyLib --> io
    prisma --> db[("PostgreSQL")]
    jobs --> db
```

Startup order: validate env (`config.ts`, exit on error) → connect Prisma → start pg-boss and register jobs → run missed crons once (meeting generation, expired attempts) → prepare Next.js → listen.
Shutdown order: stop accepting → close sockets → `boss.stop()` → `prisma.$disconnect()`.

---

## 5. Repository and code structure

```mermaid
flowchart LR
    root["repo root<br/>package.json workspaces<br/>render.yaml, .env.example"]
    root --> web["apps/web<br/>Next.js frontend"]
    root --> api["apps/api<br/>Express, Socket.IO, jobs"]
    root --> shared["packages/shared<br/>Zod schemas, enums,<br/>constants, error codes"]
    root --> prismaDir["prisma<br/>schema, migrations, seed"]
    root --> docs["docs<br/>PRD, specs, plans,<br/>architecture"]
    root --> e2e["e2e<br/>Playwright tests"]
    root --> scripts["scripts<br/>spec-check, backup"]

    web -->|imports| shared
    api -->|imports| shared
    api -->|generated client| prismaDir
    web -.->|"HTTP + WebSocket only,<br/>never the database"| api
```

```
apps/api/src
  server.ts  config.ts  db.ts
  middleware/   session, csrf, requireRole, rateLimit, upload, errorHandler
  lib/          permissions, storage, mail, audit, time, push, pagination, http
  modules/<m>/  routes.ts · service.ts · policy.ts · *.test.ts
  jobs/         index.ts + one file per job
  realtime/     socket auth, rooms, event handlers

apps/web/src
  app/          (public) · (onboarding) · (app)/admin|teacher|student|feed|messages|…
  components/   ui/ (shadcn) · shared/ · feature folders
  lib/          api.ts · queryKeys.ts · socket.ts · time utils
```

**Rule of the layers:** route (authenticate → authorize → validate → call service → respond) → service (rules, receives `actor`, never `req`) → Prisma. Shared Zod schemas validate both the API and the forms.

---

## 6. Backend modules

Each box is a folder in `apps/api/src/modules/`. Arrows mean "calls the service of".

```mermaid
flowchart TB
    auth["auth<br/>login, TOTP, sessions,<br/>tokens, profile"]
    users["users<br/>accounts, import, move,<br/>pass-out, anonymise"]
    academics["academics<br/>sessions, groups, sections,<br/>courses, offerings, mentors"]
    schedule["schedule<br/>periods, rooms, routine,<br/>holidays, meetings"]
    attendance["attendance<br/>sheets, records, %"]
    classes["classes<br/>online classes, joins"]
    materials["materials<br/>recordings, notes,<br/>previous questions"]
    exams["exams<br/>bank, exams, attempts,<br/>grading, ranks"]
    feed["feed<br/>posts, pins, comments,<br/>reactions, reports"]
    chat["chat<br/>conversations, messages,<br/>blocks"]
    notices["notices"]
    notifications["notifications<br/>in-app, email, push"]
    books["books<br/>catalog, unlock, reader"]
    ai["ai<br/>study assistant"]
    admin["admin<br/>Student 360, moderation,<br/>reports, settings"]
    files["files<br/>uploads, signed URLs"]

    users --> academics
    users --> chat
    academics --> chat
    academics --> schedule
    schedule --> notifications
    attendance --> schedule
    attendance --> notifications
    classes --> schedule
    classes --> notifications
    materials --> files
    materials --> notifications
    exams --> academics
    exams --> notifications
    feed --> files
    feed --> notifications
    chat --> files
    chat --> notifications
    notices --> notifications
    books --> files
    ai --> materials
    ai --> exams
    admin --> users
    admin --> feed
    admin --> attendance
    admin --> exams
    users --> exams
    auth --> notifications

    perms[["lib/permissions.ts<br/>used by every module"]]
    audit[["lib/audit.ts<br/>every Admin write"]]
```

Cross-cutting helpers every module uses: `permissions.ts` (role + assignment checks), `audit()` (Admin writes), `notify()` (notifications), `storage.ts` (files), `time.ts` (Asia/Dhaka), `chatMembership.sync()` (group/section chats), `revokeAllSessions()` (logout everywhere).

---

## 7. Request pipeline

Every `/api` request goes through the same chain. Public routes are mounted before the auth chain.

```mermaid
flowchart LR
    req["HTTP request"] --> pub{"public route?<br/>health, login, TOTP login,<br/>forgot/reset, verify, /api/public"}
    pub -->|yes| rl1["rate limit"] --> handler
    pub -->|no| csrf{"write method?<br/>needs X-Requested-With: cms"}
    csrf -->|missing| e403a["403"]
    csrf -->|ok| sess{"session cookie valid?<br/>hash lookup, not revoked,<br/>not expired, user active"}
    sess -->|no| e401["401 SESSION_ENDED<br/>cookie cleared"]
    sess -->|yes| first{"first_login?"}
    first -->|"yes, not an auth route"| e403b["403 FIRST_LOGIN_REQUIRED"]
    first -->|no| stepup{"Admin step-up<br/>or TOTP not set?"}
    stepup -->|"yes, not a TOTP route"| e403c["403"]
    stepup -->|no| role{"requireRole"}
    role -->|denied| e403d["403 FORBIDDEN"]
    role -->|ok| zod["Zod validate<br/>unknown keys stripped"]
    zod -->|invalid| e400["400 VALIDATION_ERROR<br/>with fields"]
    zod -->|ok| handler["route handler"]
    handler --> svc["service: assignment check<br/>teachesOffering, mentorsSection, …"]
    svc -->|not visible| e404["404 NOT_FOUND"]
    svc -->|business conflict| e409["409 SECTION_FULL,<br/>EXAM_LOCKED, …"]
    svc -->|ok| res["200 / 201<br/>resource or items + nextCursor"]
```

All errors use one shape: `{ "error": { "code", "message", "fields?" } }`. A 500 never includes a stack trace.

---

## 8. Roles and permissions

```mermaid
flowchart TB
    subgraph roles["Roles (User.role)"]
        A["admin<br/>exactly one account"]
        T["teacher"]
        S["student"]
    end

    subgraph assign["Assignments (from data, not roles)"]
        CT["Course teacher<br/>CourseOffering.teacherId"]
        SM["Section Mentor<br/>Section.mentorTeacherId<br/>max one section per teacher"]
        EN["Enrolled student<br/>active Enrollment"]
        SUB["Substitute<br/>ClassMeeting.substituteTeacherId"]
    end

    T --> CT
    T --> SM
    T --> SUB
    S --> EN

    A -->|"everything Admin-controlled:<br/>accounts, sessions, schedule,<br/>moderation, books, settings"| ALL["all data<br/>(never AI chats)"]
    CT -->|"own offerings: classes, recordings,<br/>notes, exams, attendance, notices"| OFF["offering data"]
    SM -->|"own section: attendance, notices,<br/>pins, recordings, notes, monitoring"| SEC["section data"]
    EN -->|"own courses, own results,<br/>own attendance"| OWN["own data"]
```

| Policy helper (`lib/permissions.ts`) | True when |
|---|---|
| `isAdmin` | role = admin |
| `teachesOffering` | actor is the offering's teacher |
| `mentorsSection` | actor is the section's mentor |
| `teachesInSection` | actor teaches any offering of the section |
| `canManageOffering` | admin, offering teacher, or mentor where the PRD allows |
| `isEnrolled` | student has an active enrollment |
| `canTakeAttendance` | admin, meeting teacher, substitute, or mentor of a covered section |
| `canSeeStudentPrivate` | admin or the student themself |

Hiding buttons in the UI is cosmetic. **The API is the guard**, and objects the actor may not see return 404.

---

## 9. Academic structure

```mermaid
flowchart TB
    session["Session e.g. 2025–26<br/>status active / closed"]
    session --> gS["Group: Science"]
    session --> gC["Group: Commerce"]
    session --> gA["Group: Arts"]
    gS --> s11A["Section A, Class 11<br/>max 30 active students<br/>one mentor"]
    gS --> s11B["Section B, Class 11"]
    gS --> s12A["Section A, Class 12"]
    s11A --> off1["CourseOffering<br/>Physics 1st + teacher"]
    s11A --> off2["CourseOffering<br/>Chemistry 1st + teacher"]
    catalog["Course catalog<br/>code, group type, class, paper,<br/>optional, chapters"] -.->|assigned per section| off1
    catalog -.-> off2
    off1 --> enr["Enrollment per student<br/>active / ended, history kept"]
    stud["Student"] --> enr
    stud -->|current section| s11A
```

- Creating a session creates exactly 3 groups, each with a default Section A.
- Moving or promoting a student ends old enrollments and creates new ones; past attendance and attempts keep their stored `sectionId`.
- Closing a session (pass-out) is a manual Admin action, never automatic.

---

## 10. Data model

The full schema (about 70 models) is in `docs/spec/01-database.md`. The diagrams below show the main entities and relations by domain.

### 10.1 People, access and academics

```mermaid
erDiagram
    USER ||--o| STUDENT_PROFILE : "has"
    USER ||--o| TEACHER_PROFILE : "has"
    USER ||--o{ LOGIN_SESSION : "logs in with"
    USER ||--o{ TOKEN : "reset / verify"
    USER ||--o{ LOGIN_HISTORY : "records"
    USER ||--o{ AUDIT_LOG : "acts (admin)"
    SESSION ||--|{ GROUP : "has 3"
    GROUP ||--|{ SECTION : "has"
    SECTION |o--o| USER : "mentor"
    SECTION ||--o{ STUDENT_PROFILE : "current section of"
    COURSE ||--o{ CHAPTER : "has"
    COURSE ||--o{ COURSE_OFFERING : "offered as"
    SECTION ||--o{ COURSE_OFFERING : "takes"
    USER ||--o{ COURSE_OFFERING : "teaches"
    COURSE_OFFERING ||--o{ ENROLLMENT : "has"
    USER ||--o{ ENROLLMENT : "student in"

    USER {
        string id PK
        string loginId UK
        string email UK
        enum role
        enum status
        bool firstLogin
        string totpSecretEnc
    }
    STUDENT_PROFILE {
        string userId PK
        string sectionId FK
        string roll
        date dob
    }
    SECTION {
        string id PK
        string groupId FK
        int classLevel
        string name
        string mentorTeacherId UK
    }
    COURSE_OFFERING {
        string id PK
        string sectionId FK
        string courseId FK
        string teacherId FK
        datetime endedAt
    }
    ENROLLMENT {
        string id PK
        string courseOfferingId FK
        string studentId FK
        enum status
        datetime enrolledAt
        datetime endedAt
    }
    LOGIN_SESSION {
        string id PK
        string tokenHash UK
        datetime expiresAt
        datetime revokedAt
        bool stepUpPending
    }
```

### 10.2 Schedule and attendance

```mermaid
erDiagram
    PERIOD ||--o{ ROUTINE_SLOT : "used by"
    ROOM ||--o{ ROUTINE_SLOT : "used by"
    ROUTINE_SLOT ||--|{ ROUTINE_SLOT_OFFERING : "covers"
    COURSE_OFFERING ||--o{ ROUTINE_SLOT_OFFERING : "scheduled in"
    ROUTINE_SLOT ||--o{ CLASS_MEETING : "generates"
    CLASS_MEETING ||--|{ CLASS_MEETING_OFFERING : "covers"
    COURSE_OFFERING ||--o{ CLASS_MEETING_OFFERING : "held in"
    ONLINE_CLASS |o--o{ CLASS_MEETING : "attached to"
    CLASS_MEETING ||--o{ ATTENDANCE_RECORD : "has"
    ATTENDANCE_RECORD ||--o{ ATTENDANCE_EDIT : "history"
    HOLIDAY }o--o{ CLASS_MEETING : "blocks dates"
    SPECIAL_DAY }o--o{ CLASS_MEETING : "limits periods"

    ROUTINE_SLOT {
        string id PK
        enum day
        string periodId FK
        string roomId FK
        datetime deletedAt
    }
    CLASS_MEETING {
        string id PK
        string routineSlotId FK "null = extra class"
        date date
        date originalDate "set when moved"
        bool manuallyEdited
        time startTime
        time endTime
        string teacherId FK
        string substituteTeacherId FK
        enum status
        datetime attendanceTakenAt
    }
    ATTENDANCE_RECORD {
        string id PK
        string classMeetingId FK
        string studentId FK
        string courseOfferingId FK
        string sectionId "section at the time"
        enum status
    }
```

### 10.3 Exams

```mermaid
erDiagram
    USER ||--o{ QUESTION : "owns (teacher bank)"
    COURSE ||--o{ QUESTION : "for"
    COURSE_OFFERING ||--o{ EXAM : "has"
    EXAM ||--|{ EXAM_QUESTION : "snapshot of"
    QUESTION |o--o{ EXAM_QUESTION : "copied from"
    EXAM ||--o{ EXAM_ATTEMPT : "taken as"
    USER ||--o{ EXAM_ATTEMPT : "student"
    EXAM_ATTEMPT ||--o{ ANSWER : "has"
    EXAM_QUESTION ||--o{ ANSWER : "answered"
    EXAM_ATTEMPT ||--o{ ATTEMPT_EXTENSION : "extra time"
    EXAM ||--o{ EXAM_CHANGE_LOG : "key fixes"

    EXAM {
        string id PK
        enum kind "exam or quiz"
        enum status "draft published closed"
        datetime startAt
        datetime endAt
        int durationMin
        decimal totalMarks
        enum resultMode
        datetime revealedAt
        datetime resultsPublishedAt
    }
    EXAM_QUESTION {
        string id PK
        json options
        json correct
        decimal marks
        bool isCancelled
    }
    EXAM_ATTEMPT {
        string id PK
        string sectionId "for rank"
        datetime deadlineAt
        json questionOrder
        enum status
        decimal score
    }
    ANSWER {
        string attemptId FK
        string examQuestionId FK
        json selectedOptionIds
        bool isCorrect
        decimal marksAwarded
    }
```

### 10.4 Community, chat and notices

```mermaid
erDiagram
    USER ||--o{ POST : "writes"
    POST ||--o{ POST_MEDIA : "has"
    POST ||--o{ POST_VIEW : "seen by"
    POST ||--o{ COMMENT : "has"
    COMMENT |o--o{ COMMENT : "one reply level"
    POST ||--o{ REACTION : "gets"
    COMMENT ||--o{ REACTION : "gets"
    USER ||--o{ REPORT : "files"
    USER ||--o{ USER_SANCTION : "receives"
    CONVERSATION ||--|{ CONVERSATION_MEMBER : "has"
    USER ||--o{ CONVERSATION_MEMBER : "is"
    CONVERSATION ||--o{ MESSAGE : "contains"
    USER ||--o{ BLOCK : "blocks"
    NOTICE ||--o{ NOTICE_RECIPIENT : "resolved audience"
    NOTICE ||--o{ NOTICE_READ : "read by"
    USER ||--o{ NOTIFICATION : "receives"
    USER ||--o{ PUSH_SUBSCRIPTION : "devices"

    POST {
        string id PK
        string authorId FK
        enum status "published held removed"
        datetime pinnedUntil
        enum pinAudience "all or section"
        string pinSectionId
    }
    CONVERSATION {
        string id PK
        enum type "direct group section"
        string directKey UK
    }
    CONVERSATION_MEMBER {
        string conversationId FK
        string userId FK
        datetime leftAt
        string lastReadMessageId
    }
    NOTICE {
        string id PK
        enum scope "central or class"
        json audience
        enum priority
        datetime publishAt
        datetime expiresAt
    }
```

### 10.5 Content, books, AI and system

```mermaid
erDiagram
    COURSE_OFFERING ||--o{ ONLINE_CLASS_OFFERING : "in"
    ONLINE_CLASS ||--|{ ONLINE_CLASS_OFFERING : "covers"
    ONLINE_CLASS ||--o{ ONLINE_CLASS_JOIN : "join clicks"
    COURSE ||--o{ RECORDED_CLASS : "has"
    RECORDED_CLASS ||--o{ RECORDING_PROGRESS : "watched"
    MATERIAL ||--o{ MATERIAL_FILE : "has"
    MATERIAL ||--o{ MATERIAL_CHUNK : "AI text"
    MATERIAL ||--o{ MATERIAL_VIEW : "views"
    COURSE ||--o{ PREVIOUS_QUESTION : "has"
    BOOK ||--o{ BOOK_PURCHASE : "unlocked by"
    USER ||--o{ BOOK_PURCHASE : "student"
    USER ||--o{ AI_CONVERSATION : "student, private"
    AI_CONVERSATION ||--o{ AI_MESSAGE : "has"
    USER ||--o{ AI_USAGE : "daily count"
    STORAGE_OBJECT ||--o{ MATERIAL_FILE : "file"
    STORAGE_OBJECT ||--o{ POST_MEDIA : "file"
    STORAGE_OBJECT ||--o{ BOOK : "pdf, preview, cover"

    STORAGE_OBJECT {
        string id PK
        enum bucket "public or private"
        string key "random, never reused"
        string mime
        int size
        datetime deletedAt "purged after 30 days"
    }
    SETTING {
        string key PK
        json value
    }
    AI_USAGE {
        string studentId FK
        date date "Asia Dhaka"
        int messageCount
    }
```

**Database rules:** every change is a Prisma migration; constraints Prisma can't express (CHECKs, partial unique indexes, the meeting expression index, full-text `tsvector`) are raw SQL in the same migration; **Row Level Security is on for every table with no policies**, so Supabase's public REST API can read nothing.

---

## 11. Authentication and sessions

### 11.1 Login (teacher / student, and Admin with TOTP)

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant API as Express API
    participant DB as PostgreSQL
    participant Q as Email queue

    B->>API: POST /api/auth/login with identifier, password
    API->>DB: rate limit check (IP, identifier)
    API->>DB: find user by loginId or email
    API->>API: argon2 verify (dummy hash if unknown user)
    alt wrong ID or password
        API-->>B: 401 INVALID_CREDENTIALS (same for both)
    else inactive or passed out
        API-->>B: 403 with specific message
    else student or teacher
        API->>DB: create LoginSession (store sha256 of token)
        API-->>B: Set-Cookie cms_session (httpOnly, Secure, SameSite=Lax)
        Note over B,API: next = complete_profile on first login, else dashboard
    else admin
        API->>DB: create session with stepUpPending = true
        API-->>B: next = totp (or totp_setup)
        B->>API: POST /api/auth/login/totp with code
        API->>API: verify code, reject reused time-step
        API->>DB: clear stepUpPending (5 wrong codes revoke session)
        API-->>B: next = dashboard
    end
    opt first login (teacher / student)
        B->>API: POST /api/me/complete-profile (new password, mobile)
        API->>DB: set firstLogin false, revoke other sessions
        API->>Q: queue verification email (high priority)
    end
```

### 11.2 Session states

```mermaid
stateDiagram-v2
    [*] --> StepUp: Admin password OK
    [*] --> Active: Teacher/Student password OK
    StepUp --> Active: correct TOTP or backup code
    StepUp --> Revoked: 5 wrong codes
    Active --> Active: request (sliding 30 days, refresh max every 10 min)
    Active --> Expired: Admin 12 h / others 30 days idle
    Active --> Revoked: logout, password change, email change,<br/>deactivate, pass-out, delete, Admin reset
    Revoked --> [*]
    Expired --> [*]
```

`revokeAllSessions()` is the single place that ends sessions. It also sends `session:revoked` to the user's sockets and disconnects them.

---

## 12. Account lifecycle

```mermaid
stateDiagram-v2
    [*] --> FirstLogin: Admin creates account<br/>(plain password shown once)
    FirstLogin --> Active: complete profile<br/>(new password + mobile)
    Active --> Inactive: Admin deactivates
    Inactive --> Active: Admin reactivates<br/>(session not closed)
    Active --> FirstLogin: Admin resets password
    Active --> PassedOut: Admin closes session<br/>or passes out a student
    Active --> Deleted: Admin deletes (anonymise)
    Inactive --> Deleted: Admin deletes
    PassedOut --> Deleted: Admin deletes
    Deleted --> [*]

    note right of PassedOut
        login blocked, removed from group and section chats,
        running exam attempts auto-submitted, data archived
    end note
    note right of Deleted
        personal fields cleared, AI chats deleted,
        posts and messages stay as "Deleted user"
    end note
```

---

## 13. Schedule, Class Meetings and attendance

### 13.1 From routine to attendance

```mermaid
flowchart LR
    admin(["Admin"]) -->|edits| tmpl["Routine template<br/>RoutineSlot: day + period + room<br/>+ offerings (combined class allowed)"]
    admin -->|sets| cal["Calendar<br/>holidays, special days"]
    admin -->|single changes| one["move, room, substitute,<br/>cancel, extra class"]
    tmpl --> gen{{"meetings.generate job<br/>nightly 00:30 Dhaka<br/>+ after every change<br/>for today .. today+14"}}
    cal --> gen
    gen --> mtg["ClassMeeting rows<br/>one per slot per date"]
    one --> mtg
    online["Online class"] -->|attach or create| mtg
    mtg --> sheet["Attendance sheet<br/>roster = enrollments active<br/>on the meeting date"]
    teacher(["Teacher / substitute /<br/>mentor / Admin"]) -->|marks| sheet
    sheet --> rec["AttendanceRecord<br/>+ AttendanceEdit history"]
    rec --> pct["Attendance %<br/>present + late / held - excused<br/>green 75, orange 60, red"]
    rec --> notif["notify: marked absent,<br/>below 75% on crossing"]
```

### 13.2 Class Meeting states

```mermaid
stateDiagram-v2
    [*] --> scheduled: generated or extra class
    scheduled --> held: first attendance submit
    scheduled --> cancelled: Admin cancels
    held --> cancelled: Admin cancels (excluded from %)
    scheduled --> removed: Admin deletes future meeting,<br/>holiday, special day, slot deleted
    removed --> [*]: kept so it is never generated again
    cancelled --> [*]
    held --> [*]
```

### 13.3 Generator rules (idempotent)

```mermaid
flowchart TB
    start(["for each date d in range, d >= today"]) --> hol{"d is a holiday?"}
    hol -->|yes| skip["skip whole day"]
    hol -->|no| slots["for each slot with weekday(d)"]
    slots --> act{"slot has active offerings<br/>in an open session?"}
    act -->|no| nextSlot["next slot"]
    act -->|yes| sd{"special day for d?<br/>session-specific first"}
    sd -->|"period not listed"| rm["ensure no scheduled meeting<br/>(mark removable as removed)"]
    sd -->|"listed or no special day"| ex{"meeting exists for<br/>slot + COALESCE(originalDate, date)?"}
    ex -->|no| ins["INSERT ... ON CONFLICT DO NOTHING<br/>copy period times, room, teacher"]
    ex -->|yes| keep{"removed, cancelled,<br/>has attendance or<br/>manually edited?"}
    keep -->|yes| leave["leave unchanged"]
    keep -->|no| upd["update from slot<br/>(routine change applies to future)"]
```

### 13.4 Taking attendance

```mermaid
sequenceDiagram
    autonumber
    participant T as Teacher (phone)
    participant LS as localStorage
    participant API as Express API
    participant DB as PostgreSQL
    participant N as notify()

    T->>API: GET /api/attendance/today
    API-->>T: today's meetings, done / pending
    T->>API: GET /api/attendance/meetings/:id/sheet
    API->>API: canTakeAttendance check
    API-->>T: header + roster (everyone Present, online joiners pre-filled)
    T->>LS: save draft att-draft:meetingId on every tap
    T->>API: POST sheet (records, clientDraftId)
    API->>DB: transaction: upsert records, AttendanceEdit on changes,<br/>set attendanceTakenAt, status held
    API->>N: marked_absent, below-threshold on crossing
    API-->>T: 200
    T->>LS: clear draft
    Note over T,API: on failure the draft stays and the UI shows "Not sent, retry"
```

---

## 14. Exams and quizzes

### 14.1 Exam lifecycle

```mermaid
stateDiagram-v2
    [*] --> draft: teacher creates
    draft --> published: publish (questions snapshotted,<br/>jobs scheduled, students notified)
    published --> published: edit before startAt<br/>(stays published, questions re-snapshotted)
    published --> live: startAt reached
    live --> live: fix answer key, cancel question,<br/>extra time (only allowed edits)
    live --> closed: endAt passed and<br/>no attempt in progress
    closed --> [*]

    note right of closed
        revealedAt set; instant mode publishes results
        automatically, manual mode waits for the teacher
    end note
```

### 14.2 Attempt states

```mermaid
stateDiagram-v2
    [*] --> in_progress: start (deadline = min(now + duration, endAt))
    in_progress --> submitted: student submits
    in_progress --> auto_submitted: deadline reached<br/>(job or lazy check)
    auto_submitted --> in_progress: teacher reopens with extra time
    submitted --> in_progress: teacher reopens with extra time
    submitted --> [*]
    auto_submitted --> [*]
```

### 14.3 Taking an exam

```mermaid
sequenceDiagram
    autonumber
    participant S as Student (phone)
    participant API as Express API
    participant DB as PostgreSQL
    participant J as pg-boss

    S->>API: POST /api/exams/:id/attempts
    API->>DB: lock exam row, check enrollment, window, attempts left
    API->>DB: insert attempt (deadlineAt, sectionId, shuffled order)
    API->>J: schedule exam.auto_submit at deadlineAt
    API-->>S: questions WITHOUT correct answers, deadlineAt, serverNow
    loop every tap
        S->>API: PUT answers/:examQuestionId
        API->>DB: one indexed write, only if now < deadlineAt
        API-->>S: saved tick (or 409 DEADLINE_PASSED)
    end
    S->>API: POST integrity events (batched every 10 s)
    alt student submits
        S->>API: POST submit
        API->>DB: grade on server, status submitted
    else browser closed
        J->>API: exam.auto_submit at deadline
        API->>DB: grade, status auto_submitted
    end
    Note over API,DB: correctness never depends on the job:<br/>every answer checks the deadline and expired attempts are finalised on read
```

### 14.4 Grading and what students see

```mermaid
flowchart TB
    q["each exam question"] --> c{"cancelled?"}
    c -->|yes| full["award full marks to everyone"]
    c -->|no| m{"selected set ==<br/>correct set exactly?"}
    m -->|yes| right["award the question's marks"]
    m -->|"no or unanswered"| zero["award 0<br/>no negative, no partial"]
    full --> sum["score = sum of awarded"]
    right --> sum
    zero --> sum

    sum --> vis{"what the student sees"}
    vis -->|"before reveal, instant mode"| v1["total score only"]
    vis -->|"before results, manual mode"| v2["Submitted, result pending"]
    vis -->|"after reveal + results published"| v3["per-question result, section rank,<br/>correct answers only if showAnswersAfterEnd"]
```

Ranks use competition ranking (1, 2, 2, 4) **within the section of the attempt**. Overall course rank = average % over published Exams (missed = 0%), quizzes excluded.

---

## 15. Community feed and pinned posts

### 15.1 Building the feed

```mermaid
flowchart TB
    req["GET /api/feed (first page)"] --> pinned["pinned for me:<br/>published, pinnedUntil > now,<br/>audience all OR my section,<br/>no PostView by me"]
    pinned --> order["Admin pins newest first,<br/>then mentor pins newest first"]
    req --> items["all other published posts<br/>newest first, 20 per page,<br/>excluding the pinned ones above"]
    order --> resp["response: pinned[] + items[] + nextCursor"]
    items --> resp
    resp --> ui["UI: 5 pins expanded,<br/>'Show N more announcements'"]
    ui --> seen["card at least 50% visible for 1 s<br/>POST /api/feed/seen"]
    seen --> pv[("PostView")]
    pv -.->|next load| pinned
```

### 15.2 Pinned post lifecycle

```mermaid
stateDiagram-v2
    [*] --> PinnedUnseen: Admin or Section Mentor posts<br/>with pin on (only at creation)
    PinnedUnseen --> Timeline: user has seen it (next load)
    PinnedUnseen --> Timeline: 7 days passed (pin_days)
    PinnedUnseen --> Timeline: Admin unpins
    Timeline --> PinnedUnseen: Admin extends<br/>(only for users who have not seen it)
    Timeline --> [*]
```

### 15.3 Moderation

```mermaid
flowchart LR
    post["post / comment"] --> bw{"banned word?"}
    bw -->|yes| held["held: visible to author + Admin"]
    bw -->|no| pub["published"]
    pub --> rep["users report it"]
    rep --> queue["Admin moderation queue"]
    held --> queue
    queue --> act{"Admin action"}
    act --> d1["dismiss"]
    act --> d2["delete (removed 30 days, then hard delete)"]
    act --> d3["delete + warn"]
    act --> d4["mute N days<br/>(no posts, comments, messages)"]
    act --> d5["approve held item"]
    d2 --> aud[("AuditLog + author notified")]
    d3 --> aud
    d4 --> aud
```

---

## 16. Real-time chat

### 16.1 Socket rooms

```mermaid
flowchart LR
    sock["Socket connection<br/>(cookie checked like HTTP)"] --> ru["room user:id<br/>notifications, session revoked"]
    sock --> rc1["room conv:id for every<br/>active membership"]
    sync["chatMembership.sync()<br/>after create, move, pass-out,<br/>mentor or teacher change"] -->|socketsJoin / socketsLeave| rc1

    subgraph types["Conversation types"]
        direct["direct: two users<br/>student-student, teacher-student,<br/>teacher-teacher, Admin-anyone"]
        group["group: students of a session group<br/>+ mentors of its sections"]
        section["section: section students + mentor<br/>+ teachers of its offerings"]
    end
```

The Admin is never in group or section chats; the Admin sees a chat only through a report (the message plus 10 before and 10 after).

### 16.2 Sending a message

```mermaid
sequenceDiagram
    autonumber
    participant A as Sender
    participant IO as Socket.IO server
    participant SVC as chat service
    participant DB as PostgreSQL
    participant B as Receiver (online)
    participant N as notify() / push

    A->>IO: msg:send (conversationId, clientId, text)
    IO->>SVC: same rules as REST
    SVC->>SVC: member? not left? not muted? not blocked?<br/>30 per min? banned word?
    alt rule fails
        SVC-->>A: ack ok false + code (422 BLOCKED_WORD stores nothing)
    else ok
        SVC->>DB: persist message, update lastMessageAt
        SVC-->>A: ack ok true + message
        SVC->>IO: emit msg:new to conv:id
        IO-->>B: msg:new
        SVC->>N: offline members: new_message (max 1 per conversation per 5 min)
        B->>IO: msg:read (lastReadMessageId, forward only)
        IO-->>A: msg:read, shows "Seen"
    end
    Note over A,B: on reconnect the client fetches messages after its last id
```

---

## 17. Notices, notifications, email and push

### 17.1 Notification fan-out

```mermaid
flowchart LR
    ev["any event<br/>(notice, exam, absent,<br/>message, pin, …)"] --> notify["notify(userIds, type, ref, text)"]
    notify --> row[("Notification rows")]
    notify --> sock["socket notif:new<br/>with unread count"]
    notify --> prefs{"user prefs<br/>per type"}
    prefs -->|push on| pq["push.send job"]
    prefs -->|"email on, or urgent notice<br/>(cannot be turned off)"| eq["email.send job"]
    pq --> ws["web-push<br/>title + generic text only<br/>404/410 deletes subscription"]
    eq --> quota{"EmailQuota today<br/>below daily limit?"}
    quota -->|yes| smtp["Gmail SMTP<br/>3 retries, backoff"]
    quota -->|no| tomorrow["retry 00:05 Dhaka next day"]
    smtp -->|SMTP blocked| log["demo: link written to log<br/>(LOG_EMAIL_LINKS)"]
```

Email priority: **high** (reset, verification, email change) goes first and may use the last 10% of the daily limit; **normal** (notices) stops at 90%. In-app notifications are never delayed by email.

### 17.2 Publishing a notice

```mermaid
sequenceDiagram
    autonumber
    participant Au as Admin / teacher / mentor
    participant API as Express API
    participant J as notice.publish job
    participant DB as PostgreSQL
    participant N as notify()

    Au->>API: POST /api/notices (audience, sanitised HTML, priority, publishAt)
    API->>API: check audience allowed for author
    API->>DB: save notice
    API->>J: schedule at publishAt (now if empty)
    J->>DB: skip if already published (idempotent)
    J->>DB: resolve audience, insert NoticeRecipient in batches of 1,000
    J->>N: notice_new to all recipients (socket + push)
    J->>N: email if important or urgent
    J->>DB: set publishedAt
```

---

## 18. Learning content and online classes

```mermaid
flowchart TB
    subgraph live["Online class (no video integration)"]
        oc["Teacher pastes Meet / Jitsi https link<br/>for one or more own offerings"] --> attach["attach to the routine meeting<br/>at that time, or create an extra meeting"]
        oc --> remind["jobs: reminder at start - 15 min,<br/>status live / ended"]
        join["Student taps Join<br/>(start - 10 min .. end)"] --> log[("OnlineClassJoin")]
        log --> prefill["pre-fills attendance"]
        join --> newtab["opens the link in a new tab"]
    end

    subgraph rec["Recorded classes"]
        url["YouTube or Drive link"] --> parse["URL parser → videoId<br/>(other hosts rejected)"]
        parse --> embed["youtube-nocookie / Drive preview iframe"]
        embed --> watched[("RecordingProgress = watched")]
    end

    subgraph notes["Notes, materials, previous questions"]
        up["Upload (type checked by content)"] --> so[("StorageObject, private")]
        open["Student opens file"] --> chk["visibility check:<br/>enrolled offering, own section,<br/>own group, or college-wide"]
        chk --> mv[("MaterialView")]
        mv --> signed["302 to 5-minute signed URL"]
        up -->|PDF| extract["material.extract_text job<br/>→ MaterialChunk for AI"]
    end
```

---

## 19. File storage

### 19.1 Upload

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant API as Express (multer memory)
    participant FT as file-type + sharp
    participant ST as Supabase Storage
    participant DB as PostgreSQL

    B->>API: multipart upload (size checked in the browser first)
    API->>API: per-route size limit, 60 uploads per hour per user
    API->>FT: detect real type from bytes
    alt not allowed (e.g. renamed .exe)
        API-->>B: 400
    else image
        FT->>FT: rotate, max 1600 px, WebP q80, strip metadata
    end
    API->>ST: upload with random key purpose/yyyy/mm/cuid.ext (never overwrite)
    API->>DB: insert StorageObject
    API-->>B: file id
```

### 19.2 Download and delete

```mermaid
flowchart LR
    ask["GET a file"] --> perm{"permission check<br/>for the owning resource"}
    perm -->|denied| e404["404"]
    perm -->|"public bucket<br/>(logo, banner, landing notices, book covers)"| pub["plain public URL"]
    perm -->|private bucket| sign["signed URL, 5 minutes<br/>office files as download"]
    del["delete"] --> mark["StorageObject.deletedAt = now"]
    mark --> purge["storage.purge job 03:00 Dhaka<br/>removes from storage after 30 days"]
```

---

## 20. Book shop

```mermaid
sequenceDiagram
    autonumber
    participant Ad as Admin
    participant API as Express API
    participant J as book.make_preview job
    participant ST as Storage
    participant S as Student

    Ad->>API: POST /api/books (cover, PDF up to 50 MB, preview pages "1-5,9")
    API->>ST: cover to public bucket, PDF to private bucket
    API->>J: enqueue
    J->>ST: read PDF, copy chosen pages with pdf-lib
    J->>ST: save separate preview PDF (private)
    J->>API: set publishedAt (book now visible)
    S->>API: GET /api/books/:id
    API-->>S: details + signed preview URL
    S->>API: POST /api/books/:id/pay (confirm)
    API->>API: payment.unlock() inserts BookPurchase<br/>(price snapshot, no gateway, idempotent)
    S->>API: GET /api/books/:id/pdf
    API->>API: purchase exists? else 403
    API-->>S: signed URL to the full PDF (5 min) → react-pdf reader
```

`books/payment.ts` is the only place that "pays", so a real payment gateway can replace it later without changing the student flow.

---

## 21. AI study assistant

```mermaid
sequenceDiagram
    autonumber
    participant S as Student
    participant API as ai service
    participant DB as PostgreSQL
    participant G as Groq API

    S->>API: POST /api/ai/conversations/:id/messages (question)
    API->>API: role student? 6 per minute?
    API->>DB: in-progress exam attempt?
    alt live exam
        API-->>S: 423 AI disabled during exam
    end
    API->>DB: AIUsage +1 only if below daily limit (one statement, Dhaka date)
    alt limit reached
        API-->>S: 429 used today's AI messages
    end
    API->>DB: save user message
    API->>DB: full-text search top 3 chunks from the student's own courses
    API->>API: build prompt: system prompt + notes + last 12 messages<br/>NO name, ID, phone or section
    API->>G: stream chat (model from Settings, 30 s timeout)
    alt provider error, 429, timeout
        API->>DB: refund the count
        API-->>S: 503 assistant busy, try later
    else ok
        G-->>API: tokens
        API-->>S: text/event-stream, answer appears progressively
        API->>DB: save assistant message + token count
    end
```

**Privacy:** AI chats are visible only to the student. They are not in Student 360°, not visible to teachers or the Admin (the Admin sees only daily usage counts), and are deleted with the account. The Groq key exists only on the server.

---

## 22. Background jobs

```mermaid
flowchart LR
    subgraph cron["Cron (Asia/Dhaka)"]
        c1["00:30 meetings.generate"]
        c2["03:00 storage.purge"]
        c3["03:30 housekeeping<br/>rate-limit rows, tokens, old sessions"]
        c4["hourly pin.expire (optional)"]
    end
    subgraph timed["Scheduled at a time"]
        t1["exam.starting_soon: start - 15 min"]
        t2["exam.auto_submit: attempt deadline"]
        t3["exam.close_check: endAt, then every 5 min"]
        t4["online_class.remind / status"]
        t5["notice.publish: publishAt"]
    end
    subgraph queued["Queued by events"]
        q1["email.send (priority, daily quota)"]
        q2["push.send"]
        q3["exam.regrade"]
        q4["book.make_preview"]
        q5["material.extract_text"]
        q6["meetings.generate on demand"]
    end
    cron --> boss[("pg-boss tables<br/>in PostgreSQL")]
    timed --> boss
    queued --> boss
    boss --> workers["workers in the Express process"]
```

Rules for every job:
- **Idempotent:** running it twice changes nothing.
- **Late-safe:** the free server may sleep; on boot, missed crons run once and expired exam attempts are finalised.
- **Never the only guard:** exam deadlines, pin expiry and notice expiry are also checked on every request.

---

## 23. Security architecture

```mermaid
flowchart TB
    subgraph edge["Edge"]
        https["HTTPS (Render)"]
        headers["helmet: HSTS, CSP with per-request nonce,<br/>frame-src only YouTube-nocookie and Drive"]
    end
    subgraph identity["Identity"]
        cookie["httpOnly, Secure, SameSite=Lax cookie<br/>only sha256 of the token in DB"]
        csrf["CSRF: X-Requested-With: cms on writes"]
        argon["argon2 passwords, password policy"]
        totp["Admin TOTP + 10 backup codes,<br/>secret AES-256-GCM encrypted"]
        rl["rate limits in PostgreSQL<br/>login, TOTP, forgot, chat, AI, uploads, reports"]
    end
    subgraph authz["Authorization"]
        role["role check"]
        assign["assignment check<br/>(teaches / mentors / enrolled)"]
        hide["404 for objects the actor may not see"]
        closed["409 for writes into closed sessions"]
    end
    subgraph data["Data protection"]
        zod["Zod: validate, strip unknown keys"]
        san["sanitize-html for notices,<br/>everything else escaped"]
        files["file type by content, size limits,<br/>random keys, signed URLs"]
        rls["Supabase RLS on, no policies"]
        priv["private fields only to the student and Admin"]
        exam["no correct answers before reveal"]
        audit["AuditLog for every Admin write,<br/>no personal data"]
        logs["pino logs redact secrets,<br/>never message, post or AI text"]
    end
    edge --> identity --> authz --> data
```

---

## 24. Frontend architecture

### 24.1 App structure

```mermaid
flowchart TB
    rootL["Root layout<br/>fonts, theme, CSP nonce, Query provider"]
    rootL --> public["(public)<br/>landing, login, forgot, reset, verify"]
    rootL --> onboard["(onboarding)<br/>complete-profile, admin setup (password + TOTP)"]
    rootL --> appL["(app) layout<br/>auth guard via /api/auth/me,<br/>role shell, socket provider, bottom nav"]
    appL --> adminR["/admin/…<br/>dashboard, sessions, sections, courses,<br/>teachers, students, 360°, schedule,<br/>notices, moderation, books, reports, settings"]
    appL --> teacherR["/teacher/…<br/>today, courses workspace, attendance,<br/>exams, bank, routine, mentor section"]
    appL --> studentR["/student/…<br/>home, courses, live, recordings, notes,<br/>exams, progress, routine, attendance,<br/>books, AI"]
    appL --> sharedR["shared: /feed, /messages, /notifications,<br/>/notices, /profile, /u/id"]
```

### 24.2 Data flow in the browser

```mermaid
flowchart LR
    page["Page component"] --> hook["TanStack Query hook"]
    hook --> apiC["lib/api.ts<br/>adds X-Requested-With,<br/>parses error shape"]
    apiC -->|same-origin fetch, cookie| server["Express /api"]
    apiC -->|401| login["redirect /login"]
    apiC -->|FIRST_LOGIN_REQUIRED| cp["redirect /complete-profile"]
    sockC["lib/socket.ts"] -->|"msg:new, notif:new,<br/>session:revoked"| cache["Query cache updates"]
    cache --> page
    forms["React Hook Form + shared Zod schema"] --> apiC
    sw["Service worker<br/>push + offline shell,<br/>never caches /api"] -.-> page
```

Phone-first rules: designed at 360 px; bottom tab bar (5 items) on phones, sidebar on `lg`; dialogs become full-screen sheets; tables become cards; touch targets ≥ 44 px; inputs ≥ 16 px; heavy libraries (Recharts, react-pdf, KaTeX, TipTap, YouTube iframe) lazy-loaded; no animation on the exam page; every time shown in Asia/Dhaka.

---

## 25. CI/CD and environments

```mermaid
flowchart LR
    dev["Developer machine<br/>Docker Postgres 15 for tests,<br/>Supabase dev project"] -->|git push| gh["GitHub main"]
    gh --> ci["GitHub Actions CI"]
    subgraph ciSteps["CI steps"]
        i["npm ci"] --> tc["typecheck"] --> lint["lint"] --> mig["migrate on service Postgres"] --> test["Vitest unit + API tests"] --> spec["spec:check --strict<br/>(finished milestones)"] --> build["build"]
        build --> e2e["Playwright 360 x 740<br/>(main only)"]
    end
    ci --> ciSteps
    gh -->|auto deploy| render["Render build:<br/>npm ci, prisma migrate deploy,<br/>npm run build"]
    render --> live["Live: cms-demo.onrender.com"]
    live --> hc["health check /api/health"]
    backup["scripts/backup.sh from developer PC<br/>pg_dump, keep 30 days"] -.-> supa[("Supabase DB")]
    render --> supa
```

| Environment | Database | Purpose |
|---|---|---|
| Local dev | Supabase dev project or local Postgres | Development, demo seed (60 students) |
| Test (local + CI) | Disposable Postgres 15, reset per run | Vitest API tests, Playwright |
| Demo / production | Supabase free project, Render free service | Client demo; real launch later on Oracle Always Free |

---

## 26. Quality attributes and how the design meets them

| Requirement (PRD §8) | How the architecture meets it |
|---|---|
| Pages < 2 s on 4G, feed 20 per page | Phone-first light pages, lazy heavy libraries, server-rendered landing page, cursor pagination, batched signed URLs, WebP images |
| Chat < 1 s | Socket.IO on the same server, persist-then-emit, no extra hops |
| 500 concurrent exam takers | Answer save is one indexed write, snapshot questions cached in memory, connection pool tuned, load test before launch |
| ~3,000 users | Indexed queries, aggregates in SQL, notices resolved in batches |
| Availability | Health check + uptime monitor, late-safe jobs, server-side deadline checks |
| Security and privacy | Section 23; private fields only to the student and the Admin; RLS; signed URLs |
| Backups | `pg_dump` script, 30 days; files never overwritten, deleted files purged after 30 days |
| Timezone | UTC stored, Asia/Dhaka shown, date-only values are Dhaka dates, `lib/time.ts` everywhere |
| Bangla | Unicode everywhere, `simple` full-text config, Unicode-aware banned-word matcher, Bangla font in PDFs |
| Cost | All services on free plans; one Render service (750 h/month covers one) |

---

## 27. Key architecture decisions

| # | Decision | Why | Trade-off |
|---|---|---|---|
| 1 | Modular monolith, one Node process (Express + Next.js) | One address, first-party cookie, no CORS, fits one free Render service | Can't scale web and API separately (not needed at ~3,000 users) |
| 2 | PostgreSQL for everything (data, sessions, rate limits, jobs) | No Redis to host or pay for | Slightly more DB load; fine at this size |
| 3 | Own `LoginSession` table instead of JWT or Supabase Auth | Instant revoke (deactivate, pass-out), Admin-issued login IDs | One DB lookup per request (indexed hash) |
| 4 | Supabase only for Postgres + Storage, RLS on with no policies | Public `anon` key can read nothing | Supabase Auth, Realtime and REST are unused |
| 5 | pg-boss jobs inside the app | Free, transactional with the same DB | Jobs pause when the free server sleeps → every job is late-safe and never the only guard |
| 6 | Class Meetings generated from a routine template | Attendance, cancellations and substitutes need concrete rows | Generator must be idempotent (unique expression index) |
| 7 | Exam questions snapshotted on publish; server-side grading and clock | Bank edits never change exams; no cheating through the client | Key fixes need an explicit regrade |
| 8 | Files via signed URLs, never proxied | Saves RAM and bandwidth on the free plan, private by default | URLs expire after 5 minutes (UI refetches) |
| 9 | Groq as AI provider behind a provider adapter | Client decision (terms allow minors); free tier | Model/provider changeable in Settings |
| 10 | Full-text search for AI grounding, no embeddings | Free, works for Bangla with the `simple` config | Less semantic than vector search |
| 11 | No payment gateway; `payment.unlock()` isolated | Client accepted; easy to add a gateway later | Books are unlocked without money |
| 12 | Phone-first UI, PWA | ~95% of users are on phones | Desktop layouts are enlargements, not separate designs |
