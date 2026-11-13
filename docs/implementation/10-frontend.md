# Plan 10 · Frontend (Milestone M4 shell, then every milestone)

Spec: `docs/spec/10-frontend.md` · PRD §5.1–5.6, `docs/dashboards.md`, `docs/landing-page.md`, tech.stack §2. Agents: `ui-designer` (first), `web-builder`, `qa-tester`. Skill: `cms-frontend`.
**Phone first at 360 px — about 95% of users are on phones.**

## 1. Strategy

The frontend is not one milestone. M4 builds the **shell, design system and shared components**; every later milestone ships its own screens using them. Spec 10's FE IDs are mostly global checks (no horizontal scroll on every route, states everywhere), so they are run at M4 for existing routes and re-run at each milestone, and complete at M12.

## 2. M4 build order

1. **Design pass** (`ui-designer`, before code): tokens (colour, type scale with 16 px body minimum, spacing, radius, shadow), light theme first, dark optional; landing page layout per `landing-page.md`; dashboard card patterns per `dashboards.md`; empty/loading/error state patterns. Output: Tailwind theme + `globals.css` CSS variables + shadcn theme. Bangla-capable font stack (Noto Sans Bengali fallback, `font-display: swap`, subset).
2. **App skeleton** (§1): route groups `(public)`, `(onboarding)`, `(app)`; `(app)/layout.tsx` auth guard via `GET /api/auth/me` (TanStack Query, suspense skeleton), role shell, socket provider (connects after `me` resolves), bottom nav.
3. **`lib/api.ts`**: fetch wrapper (`credentials: 'same-origin'`, `X-Requested-With: cms`, error shape → typed `ApiError`), 401 → `/login`, `FIRST_LOGIN_REQUIRED` → `/complete-profile` (FE-07). `lib/queryKeys.ts` per module. `lib/socket.ts` with cache updaters.
4. **`middleware.ts`**: cookie-presence redirect only (UX), never security.
5. **Navigation** (§3): per-role bottom tab bar (5 max) + "More" drawer (`vaul`); top bar with title, bell (live unread count), avatar; sidebar at `lg` (FE-04).
6. **Shared components** (§4) built now, with Storybook-free "kitchen sink" page at `/dev/components` (dev only): `ResponsiveDialog`, `DataCards`, `EmptyState`, `ErrorState`, `Skeleton`, `StatusPill`, `CountdownBadge`, `DhakaTime`, `FileUpload`, `RoleGate`, `AuthorLine`. Feature components (`PostCard`, `AttendanceSheet`, `ExamTimer`, `ChatThread`, `PdfReader`…) are built in their milestones.
7. **Public pages**: landing (server component, `/api/public/*`, revalidate 5 min; role buttons; "Open my dashboard" when logged in; no heavy libraries) (FE-03), login, forgot/reset/verify.
8. **Onboarding**: complete-profile, Admin setup (new password → TOTP QR → backup codes).
9. **Dashboards with empty widgets** for Admin, Teacher, Student (filled as modules land), `/profile`.
10. **Motion**: one `motion` wrapper for page/sheet transitions (150–300 ms, transform/opacity), `useReducedMotion` → off; `ExamLayout` has no motion provider at all (FE-08).

## 3. Per-milestone screen ownership

| Milestone | Screens added |
|---|---|
| M3 | Admin sessions/sections/courses/teachers/students/import/mentors, credential slip |
| M5 | Schedule Manager, Today, attendance sheet + manual select, routines, student attendance |
| M6 | Course workspace tabs (classes, recordings, notes), student live/recordings/notes/previous questions |
| M7 | Question bank, exam builder/report, student exams/take/progress |
| M8 | Feed, post page, public profile, moderation, pinned widget |
| M9 | Messages, notifications, notices, urgent banner, prefs |
| M10 | Book shop, reader, AI chat |
| M11 | Student 360° tabs, Admin dashboard charts, reports |
| M12 | PWA install, perf polish |

## 4. Rules enforced by tooling (not by memory)

- **Playwright route crawler** (`e2e/routes.spec.ts`): logs in as each role (demo seed), visits every route in §2 at 360×740, asserts `document.documentElement.scrollWidth <= clientWidth` (FE-01), runs an axe check, collects console errors. The route list is a typed constant shared with the nav, so a new page can't be forgotten.
- **Touch targets/inputs** (FE-02): crawler measures all `button, a, [role=button], input, select, textarea` bounding boxes (≥ 44×44, font-size ≥ 16 px), with an allow-list for inline text links.
- **States** (FE-05): each data screen uses `<QueryBoundary>` (skeleton / `EmptyState` / `ErrorState`); tests force empty and 500 responses via route interception.
- **Lazy-loading** (FE-10): `next/dynamic` for Recharts, react-pdf, KaTeX, TipTap, YouTube iframe; a build test parses `.next` first-load manifests and fails if those packages appear in shared/first-load chunks.
- **Dhaka time** (FE-11): ESLint `no-restricted-syntax` bans `toLocaleString`/`toLocaleDateString` outside `DhakaTime`/`formatDhaka`; e2e runs the browser in `timezoneId: 'America/New_York'` and checks displayed times are still Dhaka.
- **Role hiding** (FE-06): UI test per role checks hidden controls; paired API deny tests already exist in each module.

## 5. Acceptance → tests

| ID | Test | Full at |
|---|---|---|
| FE-01 | `[FE-01] no horizontal scroll at 360 px on every route` | M12 (routes grow) |
| FE-02 | `[FE-02] touch targets ≥ 44 px, inputs ≥ 16 px` | M12 |
| FE-03 | `[FE-03] landing sections, role buttons, Open my dashboard, no private data` | M4 |
| FE-04 | `[FE-04] role tab bars on phone, sidebar on lg, bell count` | M4 (count live in M9) |
| FE-05 | `[FE-05] loading/empty/error states` | M12 |
| FE-06 | `[FE-06] hidden controls per role + API denies` | M12 |
| FE-07 | `[FE-07] 401 and FIRST_LOGIN_REQUIRED redirects` | M4 |
| FE-08 | `[FE-08] no animation on exam page; reduced motion off` | M7 |
| FE-09 | `[FE-09] installable PWA; SW never caches personal API data` | M12 |
| FE-10 | `[FE-10] heavy libraries lazy-loaded` | M10 |
| FE-11 | `[FE-11] all times Asia/Dhaka` | M12 |

## 6. Definition of done

M4: "Screens checked at 360 px" — FE-03/04/07 green, AUTH-14 green, crawler passing for existing routes. Each later milestone: its screens pass the crawler and the per-screen checklist (spec §6). M12: `/spec-check 10` complete.
