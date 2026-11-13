# 10 · Frontend (Next.js App Router)

Source: PRD §5.1–5.6, `docs/dashboards.md`, `docs/landing-page.md`, `docs/tech.stack.md` §2. Skill: `cms-frontend`.
**Phone first (360 px), about 95% of users are on phones.** The visual design (colours, card placement) is decided during design; this spec fixes structure and behaviour.

## 1. App structure

```
src/app
  (public)/            page.tsx (landing) · login · forgot-password · reset-password · verify-email
  (onboarding)/        complete-profile (teacher/student) · admin/setup (new password + TOTP + backup codes)
  (app)/layout.tsx     auth guard (GET /api/auth/me), role shell, socket provider, bottom nav
    admin/...          Admin routes
    teacher/...        Teacher + Section Mentor routes
    student/...        Student routes
    feed/ · messages/ · notifications/ · notices/ · profile/ · u/[id] (public profile)   shared by all roles
```

- Rendering: landing page is a server component with cached public data (`/api/public/*`, revalidate 5 min). Logged-in pages are client components using TanStack Query (cookie auth, same origin).
- API client `lib/api.ts`: `fetch` wrapper adding `X-Requested-With: cms`, parsing the error shape (00 §3), redirecting to `/login` on 401 and to `/complete-profile` on `FIRST_LOGIN_REQUIRED`.
- Query keys per module in `lib/queryKeys.ts`; socket events update caches (`msg:new`, `notif:new`).
- Middleware (`middleware.ts`) only checks cookie presence for redirects; real checks are in the API.

## 2. Route map

### 2.1 Public
| Route | Content |
|---|---|
| `/` | Header (logo, name, **Login**), hero, About, Departments, latest public notices, Book Shop preview (swipe row), Contact, footer. Three stacked role buttons: **Student Login / Teacher Login / Admin Login** (`/login?role=...`). Logged in → **Open my dashboard** instead. No heavy libraries. |
| `/login?role=` | One form: User ID or Email, Password (show/hide), role label from query only. Admin → TOTP step (`code` or "use a backup code"). Generic error. Role mismatch notice. Forgot password link. |

### 2.2 Admin (`/admin`)
| Route | Screen |
|---|---|
| `/admin` | Dashboard: stats cards, quick actions, alerts (unassigned courses, sections without mentor, reported content), charts (lazy Recharts) |
| `/admin/sessions`, `/admin/sessions/[id]` | Sessions list with Active/Closed badges → groups → sections (free places), Add student, Close session |
| `/admin/sections/[id]` | Students, offerings (Assign Courses sheet, copy), mentor, routine link |
| `/admin/courses`, `/admin/courses/[id]` | Catalog + chapters |
| `/admin/teachers`, `/admin/students` (+ `/new`, `/import`, `/[id]`) | Lists as cards, filters, create forms, CSV import with dry-run table, credential slip print view |
| `/admin/students/[id]/360` | Student 360° tabs |
| `/admin/mentors` | Section → mentor list |
| `/admin/schedule` | Schedule Manager: tabs Calendar (month/week), Routine (section picker → day-by-day list on phones, grid on `lg`), Periods, Rooms, Holidays, Special days, Room usage |
| `/admin/notices` | Central notices + create (rich text editor: TipTap minimal) |
| `/admin/moderation` | Queue, banned words |
| `/admin/books` | Catalog, purchases, reports |
| `/admin/previous-questions`, `/admin/recordings`, `/admin/materials` | College-wide uploads |
| `/admin/attendance`, `/admin/exams` | College-wide summaries |
| `/admin/reports` | CSV/PDF exports |
| `/admin/settings` | Settings keys (01 §4), college profile, AI usage, security (backup codes) |

### 2.3 Teacher (`/teacher`)
| Route | Screen |
|---|---|
| `/teacher` | Today (today's classes with Take Attendance + status, upcoming online classes with **Open meeting**, exams running), My Courses cards, Pending work, attendance widgets, **Section Mentor area** if mentor |
| `/teacher/courses/[offeringId]/[tab]` | Workspace tabs: classes · recordings · notes · exams · results · notices · attendance · students |
| `/teacher/attendance/take` | Manual select Session → Group → Section → Course → date → period |
| `/teacher/attendance/[meetingId]` | Attendance sheet (04 §6.2) |
| `/teacher/exams/[id]/edit`, `/teacher/exams/[id]/report` | Exam builder, report |
| `/teacher/bank` | Question bank |
| `/teacher/routine` | Personal weekly routine |
| `/teacher/section` | Mentor: overview, students, routine (view), notices, pinned posts, monitoring |

### 2.4 Student (`/student`)
| Route | Screen |
|---|---|
| `/student` | Pinned posts (max 5 expanded), today's routine + next class + live **Join**, upcoming exams countdown, latest notices, urgent banner, attendance card, recent results |
| `/student/courses`, `/student/courses/[offeringId]/[tab]` | Tabs: live · recordings · notes · exams · results · notices · previous-questions |
| `/student/live`, `/student/recordings`, `/student/notes`, `/student/previous-questions` | Cross-course lists |
| `/student/exams`, `/student/exams/[id]/take` | List; exam page (05 §8, no animation, no nav bar) |
| `/student/progress` | Results, ranks, charts, chapters, PDF |
| `/student/routine`, `/student/attendance` | Week/today; summary, calendar, course list |
| `/student/books`, `/student/books/[id]`, `/student/books/mine`, `/student/books/[id]/read` | Shop, details + preview, My Books, reader |
| `/student/ai`, `/student/ai/[conversationId]` | AI chats |

### 2.5 Shared
`/feed`, `/feed/posts/[id]`, `/messages`, `/messages/[conversationId]`, `/notifications`, `/notices`, `/profile`, `/u/[id]`.

## 3. Navigation (phones)

Bottom tab bar (5 items max), rest in a "More" drawer:
- Student: Home · Feed · Courses · Messages · More
- Teacher: Today · Courses · Feed · Messages · More
- Admin: Dashboard · Students · Schedule · Feed · More
Top bar: page title, bell with unread count, avatar. On `lg`, the tab bar becomes a left sidebar.

## 4. Shared components

`AuthorLine`, `PostCard` (with `useSeenTracker`), `PinnedStack` (5 + "Show N more announcements"), `ReactionBar`, `CommentThread`, `ImageGrid` (lazy), `FileUpload` (client pre-check of size/type, progress), `ResponsiveDialog` (full-screen `vaul` sheet on phones, dialog on desktop), `DataCards` (table on `md+`, stacked cards on phones), `AttendanceSheet`, `ExamTimer`, `QuestionNavigator`, `CountdownBadge`, `StatusPill` (attendance colour), `EmptyState`, `ErrorState`, `Skeleton`, `ChatThread` (virtualised list), `PdfReader` (lazy react-pdf), `RoleGate` (cosmetic only), `DhakaTime`.

## 5. Rules (from tech.stack §2)

- Tailwind mobile-first; `sm:/md:/lg:` only to enlarge. No horizontal page scroll at 360 px.
- Touch targets ≥ 44×44 px; inputs ≥ 16 px; correct `type`/`inputmode`/`autocomplete`.
- Every screen has loading (skeleton), empty and error states; mutations show `sonner` toasts and field errors from `error.fields`.
- Forms: React Hook Form + shared Zod schema; one column.
- Motion: 150–300 ms transform/opacity, respect `prefers-reduced-motion`, none on exam page or long lists.
- Lazy-load Recharts, react-pdf, KaTeX, TipTap, the YouTube iframe.
- All times via `DhakaTime` / `formatDhaka`.
- PWA: `manifest.webmanifest` (name, icons 192/512, `display: standalone`), service worker for push + offline shell (no caching of API responses with personal data).
- Accessibility: labels on every input, focus rings, keyboard-usable exam and forms, contrast AA.

## 6. Done checklist per screen

- Checked at 360 × 740 and 1280 wide; no horizontal scroll.
- Loading/empty/error states present.
- Hidden controls match the role, and the API also denies them.
- Type-check and lint pass.
