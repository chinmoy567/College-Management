# Development Specs: College Management System

These specs turn `docs/PRD.md` into buildable work: data model, API, background jobs, real-time events and screens.
**`docs/PRD.md` is the source of truth.** If a spec and the PRD disagree, the PRD wins and the spec must be fixed.
Stack and hosting are fixed by `docs/tech.stack.md`. Client decisions in `.claude/CLAUDE.md` are final.

## Files

| # | File | Covers (PRD sections) |
|---|---|---|
| 00 | [00-conventions.md](00-conventions.md) | Repo layout, coding rules, API shape, errors, pagination, permissions helpers, time, files, testing |
| 01 | [01-database.md](01-database.md) | Full Prisma schema, constraints, indexes, RLS, seed (§6) |
| 02 | [02-auth.md](02-auth.md) | Login, Admin TOTP, first login, password/email flows, sessions, rate limits (§2, §4.1–4.3, §4.6) |
| 03 | [03-academics-accounts.md](03-academics-accounts.md) | Sessions, groups, sections, courses, chapters, offerings, enrollment, accounts, CSV import, moves, promotion, pass-out, delete, Student 360° (§3, §4.4–4.5, §5.3) |
| 04 | [04-schedule-attendance.md](04-schedule-attendance.md) | Periods, rooms, routine, holidays, special days, Class Meetings, attendance (§5.17, §5.18) |
| 05 | [05-exams-progress.md](05-exams-progress.md) | Question bank, exams/quizzes, attempts, grading, regrade, extra time, ranks, progress (§5.14, §5.15) |
| 06 | [06-community.md](06-community.md) | Feed, posts, pins, reactions, comments, reports, moderation, public profile (§5.7) |
| 07 | [07-chat-notices-notifications.md](07-chat-notices-notifications.md) | Messaging, Socket.IO, notices, notifications, email queue, web push (§5.8–5.10) |
| 08 | [08-learning-content.md](08-learning-content.md) | Online classes, recorded classes, notes/materials, previous questions (§5.11–5.13, §5.16) |
| 09 | [09-bookshop-ai.md](09-bookshop-ai.md) | Book shop, AI study assistant (§5.19, §5.20) |
| 10 | [10-frontend.md](10-frontend.md) | Route map per role, layouts, shared components, phone-first rules (§5.1, §5.2, `dashboards.md`, `landing-page.md`) |
| 11 | [11-jobs-ops.md](11-jobs-ops.md) | pg-boss jobs, env vars, deployment, health check, backups, NFR checks, test plan (§8, §9) |

## Build order (milestones)

Each milestone ends with type-check, lint, tests and a PRD check (`cms-verify` skill), then **`/spec-check <spec number>`** (agent `spec-verifier`), then a commit and push. Every spec has an **Acceptance** list of IDs; each ID needs a test named `[ID] ...` (00 §9). Run `/spec-check all` before launch.

| M | Milestone | Depends on | Done when |
|---|---|---|---|
| M0 | **Scaffold**: npm workspaces, `apps/web`, `apps/api`, `packages/shared`, `prisma`, Express serving Next.js, `GET /api/health`, pino, helmet, error handler, ESLint, `render.yaml`; **test tooling**: Vitest + supertest with a test Postgres, Playwright (360 × 740 project), `scripts/spec-check.ts` (`npm run spec:check`), GitHub Actions CI | – | `npm run dev` serves the landing placeholder, `/api/health` returns `ok`, `npm test`, `npm run test:e2e` and `npm run spec:check` run |
| M1 | **Database**: full Prisma schema (01), first migration, RLS migration, seed (Admin, settings, periods) | M0 | `prisma migrate deploy` + seed run on a clean DB |
| M2 | **Auth** (02): login, sessions, Admin TOTP, first-login profile, reset, verify, change email, rate limits, socket auth helper | M1 | Auth tests pass; deactivation kills sessions |
| M3 | **Academics & accounts** (03): sessions/groups/sections, catalog, chapters, offerings, enrollment, add/import/move/promote/pass-out/delete, audit log | M2 | 30-student limit and enrollment history tested |
| M4 | **App shell** (10): landing page, login, role layouts, bottom nav, dashboards with empty widgets, profile | M2 | Screens checked at 360 px |
| M5 | **Schedule & attendance** (04): Schedule Manager, meeting generation job, attendance sheet, % calculation | M3 | Generation is idempotent; % rules tested |
| M6 | **Learning content** (08) + file storage (00 §7) | M3 | Signed URLs only after permission check |
| M7 | **Exams & progress** (05) | M3, M6 | Scoring, deadline, regrade, rank tests pass |
| M8 | **Community** (06) | M3 | Pin/seen/feed-order tests pass |
| M9 | **Chat, notices, notifications, email** (07) | M3, M8 | Chat < 1 s locally; email queue respects daily limit |
| M10 | **Book shop & AI** (09) | M6 | Full PDF never served without a purchase; AI daily limit enforced |
| M11 | **Admin extras**: Student 360°, reports/exports, dashboard stats/charts | M5–M10 | Exports open correctly |
| M12 | **Hardening & launch** (11): load test (500 concurrent exam takers), PWA, backups script, uptime monitor | all | NFR checklist in 11 §6 is green |

## Additions the PRD leaves open (decided in these specs)

These are implementation details the PRD needs but does not spell out. They do not change any PRD rule.

| Gap | Decision | Spec |
|---|---|---|
| Browser push (§5.10) has no table or library | `PushSubscription` table + `web-push` (VAPID keys in env, free) | 01, 07 |
| "Answers grounded in uploaded notes" (§5.20) has no retrieval method | Extract text from PDF notes on upload, store chunks with a PostgreSQL full-text index (`simple` config, works for Bangla), add the top chunks to the prompt. No embeddings, no paid service | 09 |
| Email daily limit (§5.9) is not in the Settings list (§6) | Setting `email_daily_limit` (default 450) + `EmailQuota` table | 01, 07 |
| File columns are `*_url` in §6 | Stored as `StorageObject` rows (bucket + key); URLs are signed on read. Supports the 30-day delayed delete (§8) | 00, 01 |
| Admin TOTP secret storage | Encrypted at rest with `TOTP_ENC_KEY` (AES-256-GCM) | 02 |
| Rate-limit store "in PostgreSQL" | `RateLimitHit` table used by an express-rate-limit store | 01, 02 |
| Exam lifecycle states | `draft → published → closed`, plus `results_published_at` and `revealed_at` | 05 |
| A Class Meeting the Admin moves to another date must not be regenerated | `ClassMeeting.original_date` + `manually_edited`; unique index on `(routine_slot_id, COALESCE(original_date, date))` | 01, 04 |
| CSRF protection for the cookie session | `SameSite=Lax` + required `X-Requested-With: cms` header on writes | 02 |