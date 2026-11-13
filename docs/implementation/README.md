# Implementation Plans: College Management System

How we will build every spec in `docs/spec/`. One plan per spec, same file name as the spec.
**Order of authority:** `docs/PRD.md` → `docs/spec/*` → these plans. If a plan disagrees with a spec, the spec wins and the plan is fixed.
Client decisions in `.claude/CLAUDE.md` are final and are never reopened here.

## Files

| Plan | Spec | Milestone | ID prefix |
|---|---|---|---|
| [00-conventions.md](00-conventions.md) | 00 Conventions + scaffold | M0 | CONV |
| [01-database.md](01-database.md) | 01 Database | M1 | DB |
| [02-auth.md](02-auth.md) | 02 Auth & profile | M2 | AUTH |
| [03-academics-accounts.md](03-academics-accounts.md) | 03 Academics, accounts, Student 360° | M3 (+ M11) | ACAD |
| [10-frontend.md](10-frontend.md) | 10 Frontend | M4 (shell), then every milestone | FE |
| [04-schedule-attendance.md](04-schedule-attendance.md) | 04 Schedule & attendance | M5 | SCH |
| [08-learning-content.md](08-learning-content.md) | 08 Learning content + files | M6 | LRN |
| [05-exams-progress.md](05-exams-progress.md) | 05 Exams & progress | M7 | EXAM |
| [06-community.md](06-community.md) | 06 Community | M8 | COMM |
| [07-chat-notices-notifications.md](07-chat-notices-notifications.md) | 07 Chat, notices, notifications | M9 | CHAT |
| [09-bookshop-ai.md](09-bookshop-ai.md) | 09 Book shop & AI | M10 | BOOK, AI |
| [11-jobs-ops.md](11-jobs-ops.md) | 11 Jobs, ops, launch | M0 (base), M12 (launch) | OPS |

## Build order and dependency graph

```
M0 Scaffold ─► M1 Database ─► M2 Auth ─┬─► M3 Academics ─┬─► M5 Schedule & Attendance ─┐
                                        │                 ├─► M6 Learning + Files ─┬─► M7 Exams ─┤
                                        │                 │                        └─► M10 Books & AI
                                        │                 ├─► M8 Community ─► M9 Chat/Notices ─┤
                                        └─► M4 App shell ─┘                                      ▼
                                                                         M11 Admin extras ─► M12 Launch
```

M4 can run in parallel with M3 (it only needs auth). M5, M6 and M8 can run in parallel after M3.

## Cross-cutting pieces that must exist earlier than their "home" spec

The spec milestones are clean on paper, but several helpers are needed before the milestone that fully owns them. We build a **minimal, final-shape** version early and complete it later, so no code is thrown away.

| Piece | Full spec | Needed first in | What we build early |
|---|---|---|---|
| pg-boss bootstrap (`jobs/index.ts`) | 11 §1 | M0 | Boss start/stop, `registerJob()` helper, graceful shutdown |
| `email.send` job + `EmailQuota` | 07 §5 | M2 (verify, reset) | Real queue with priority + daily quota + "log link when SMTP fails" |
| `lib/storage.ts` upload pipeline | 00 §7 | M2 (avatar) | Images only (sharp → WebP), `StorageObject`, signed URLs. Documents added in M6 |
| `audit()` | 00 §2 | M2 (Admin TOTP/settings) | Final version |
| `revokeAllSessions()` + socket disconnect | 02 §1, 07 §1 | M2 | Socket.IO server with auth handshake + `user:<id>` room only |
| `notify()` helper | 07 §4 | M3 (assignments), M5 (absent) | Insert `Notification` + emit `notif:new`. Email/push fan-out added in M9 |
| `chatMembership.sync()` | 07 §2.3 | M3 (student create/move, mentor change) | DB membership rows + socket room join/leave. Chat routes come in M9 |
| `activeMute()` + banned-word matcher | 06 §6 | M8 | Built in M8, reused by chat in M9 |
| Frontend screens | 10 | every milestone | M4 = shell + auth screens; each later milestone ships its own screens |

## How each milestone is run (the loop)

1. **Read** the spec and its PRD sections again. List the Acceptance IDs.
2. **Shared first:** Zod schemas + constants in `packages/shared`, then Prisma changes (if any) as a migration.
3. **Service layer with unit tests** (pure logic: grading, %, generator, permissions) — test-first for anything with rules.
4. **Routes** (thin) + API integration tests, always **allow and deny** per role.
5. **Jobs / sockets** for the module.
6. **Screens** at 360 px, with loading/empty/error states; Playwright for the (UI) IDs.
7. **Verify:** `npm run typecheck && npm run lint && npm test && npm run test:e2e`, then the `cms-verify` skill (includes PRD check), then `/spec-check <nn>`.
8. **Commit + push** per topic (CLAUDE.md), confirm the push.

A milestone is **done only when `/spec-check` reports the spec complete**. Specs whose IDs depend on later milestones (00, 10, 11) are checked partially at their milestone and fully at M12; the plan files say which IDs are expected when.

## Agents and skills per area

| Area | Agent | Skill |
|---|---|---|
| Schema, migrations, seed | `db-architect` | `cms-database`, `cms-seed-data` |
| Auth, sessions, permissions | `auth-security` | `cms-auth-permissions`, `cms-security-review` |
| API modules | `api-builder` / `senior-developer` | `cms-backend`, `cms-new-module` |
| Exams, attendance, routine | `exam-attendance-builder` | `cms-exams-attendance` |
| Sockets, jobs | `realtime-builder` | `cms-realtime-jobs` |
| Files, AI | `senior-developer` | `cms-files-ai` |
| Frontend | `web-builder`, `ui-designer` | `cms-frontend` |
| Tests | `test-writer`, `qa-tester` | `cms-testing`, `cms-run-and-test` |
| Deploy, PWA, perf | `deploy-engineer` | `cms-deploy-cloud`, `cms-performance-pwa` |
| Verification | `spec-verifier` | `spec-check`, `cms-verify` |

## M11 — Admin extras (no spec of its own)

Built after M5–M10, from pieces in several specs:
- Student 360° all tabs + PDF (03 §7) — the attendance, exams, community and books tabs need M5–M10 data.
- Admin dashboard stats, alerts and lazy Recharts charts (PRD §5.2.1, 10 §2.2).
- `/admin/reports`: CSV/PDF exports of students, results (05 §7), attendance (04 §7.1), book purchases (09 §1.1). Streamed, never stored; Bangla font embedded in pdfkit (OPS-10).
- Done when: ACAD-16 passes, every export opens correctly in Excel/LibreOffice and a PDF viewer, and `/spec-check 03` is complete.

## Global technical risks (watched in every milestone)

| Risk | Mitigation |
|---|---|
| Render free plan has ~512 MB RAM; Next.js + Express + sharp + pdfjs in one process | Lazy-`import()` sharp, pdf-lib, pdfjs, pdfkit inside the handlers/jobs; watch RSS in the load test; keep `sharp.concurrency(1)` |
| CSP `default-src 'self'` breaks Next.js inline scripts | Per-request nonce set in Express, passed to Next via header; `strict-dynamic` for scripts (see 11 plan) |
| Supabase session pooler connection cap (free plan) | One PrismaClient, `connection_limit` ≈ 10, pg-boss `max` ≈ 3; load-test proves it |
| Concurrency limits (30 students, exam start, AI daily count) | Row locks / single-statement conditional updates; each has a parallel-request test |
| Time zone bugs (Dhaka dates) | All date logic through `lib/time.ts`; tests at 18:00 UTC boundaries |
| Data leaks (private fields, correct answers, AI chats) | JSON snapshot tests on every teacher/public/student payload |
