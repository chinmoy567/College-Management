# 11 · Background Jobs, Configuration, Deployment & Quality

Source: PRD §8, §9, `docs/tech.stack.md` §3, §7–9. Skill: `cms-realtime-jobs`.

## 1. pg-boss jobs

pg-boss runs inside the Express process on `DATABASE_URL` (session pooler). Every handler is **idempotent** and safe to run late (the free server may sleep). Exam correctness never depends on a job.

| Job | Trigger | Does |
|---|---|---|
| `meetings.generate` | cron 00:30 Dhaka + on demand | 04 §4 |
| `exam.auto_submit` | at `deadlineAt` (singleton per attempt) | 05 §4.2 |
| `exam.starting_soon` | start − 15 min | notify enrolled students |
| `exam.close_check` | at `endAt`, then every 5 min while attempts are in progress | set `revealedAt`, `status=closed`, instant-mode `resultsPublishedAt`, notify |
| `exam.regrade` | after fix-key/cancel | 05 §6 |
| `online_class.remind` / `.status` | start − 15 min / start / end | notify; status update |
| `notice.publish` | at `publishAt` | 07 §3.3 |
| `email.send` | queued | 07 §5 |
| `push.send` | queued | 07 §6 |
| `pin.expire` | cron hourly | no data change needed (query uses `pinnedUntil`); clears pin badges cache, optional |
| `book.make_preview` | on book upload | 09 §1.1 |
| `material.extract_text` | on PDF material upload | 09 §2.6 |
| `storage.purge` | cron 03:00 Dhaka | delete storage objects with `deletedAt < now − 30 days`; hard-delete content removed > 30 days ago (06 §6.1) |
| `housekeeping` | cron 03:30 Dhaka | purge `RateLimitHit` > 1 day, expired `Token`s, expired `LoginSession`s > 30 days |

On boot: run any missed cron jobs once (pg-boss handles this with `schedule`), and lazily finalise expired exam attempts.

## 2. Environment variables (`.env.example`)

Everything from `tech.stack.md` §9, plus:

```
NODE_ENV=production
PORT=10000
SEED_ADMIN_EMAIL=
SEED_ADMIN_PASSWORD=          # used once; Admin must change it at first login
TOTP_ENC_KEY=                 # 32 random bytes, base64
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:office@example.edu
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
LOG_EMAIL_LINKS=true          # demo only: log reset/verify links when SMTP is blocked
SUPABASE_PUBLIC_BUCKET=public
SUPABASE_PRIVATE_BUCKET=private
```

`apps/api/src/config.ts` validates all of them with Zod at boot and exits with a clear message if one is missing. Only `NEXT_PUBLIC_*` reach the browser.

## 3. Server & deployment

- `apps/api/src/server.ts`: `helmet` (CSP: `default-src 'self'`; `img-src 'self' data: blob: <supabase>`; `frame-src youtube-nocookie.com drive.google.com`; `connect-src 'self' wss: <supabase>`), `express.json({ limit: '1mb' })`, `/api` router, Socket.IO, then `nextApp.getRequestHandler()` for everything else. `trust proxy` = 1 (Render).
- `GET /api/health` → `SELECT 1` → `200 "ok"` (no auth, no data).
- Render (`render.yaml`): one free web service; build `npm ci && npx prisma migrate deploy && npm run build`; start `node apps/api/dist/server.js`; health check path `/api/health`.
- UptimeRobot or cron-job.org pings `/api/health` every 10 minutes (keeps Render and Supabase awake).
- Supabase: region Mumbai/Singapore; buckets `public` (public) and `private`; RLS on every table with no policies (01 §3).
- Graceful shutdown: stop accepting, `boss.stop()`, close sockets, `prisma.$disconnect()`.

## 4. Backups

- `scripts/backup.sh` (run from the developer's computer, free plan has no backups): `pg_dump --format=custom "$DIRECT_URL" > backups/cms-$(date +%F).dump`, delete dumps older than 30 days. Run before every migration and at least weekly.
- Restore notes in the script header (`pg_restore --clean --no-owner`).
- Files are never overwritten and are purged only 30 days after delete (00 §7).

## 5. Load & launch checks

- **Exam load test** (k6 or autocannon, free): 500 virtual students start an exam within 2 minutes and save an answer every 20 s for 45 minutes. Pass: p95 answer save < 300 ms, no errors, DB connections within the pooler limit (Prisma `connection_limit` tuned, e.g. 10).
- **Chat:** 200 sockets, message delivered < 1 s p95.
- **Feed:** first page < 2 s on throttled 4G (Lighthouse mobile).
- **Groq:** check free-tier limits in the console; send 50 concurrent AI questions; confirm the busy message works.
- **Email:** confirm Gmail SMTP from the host; otherwise demo with logged links.

## 6. NFR checklist (PRD §8)

| Requirement | How it is checked |
|---|---|
| Pages < 2 s on 4G; feed 20/page; chat < 1 s | §5 tests, Lighthouse |
| ~3,000 users, 500 concurrent exam takers | §5 load test |
| 99.5% uptime, no exams in maintenance window | uptime monitor; exam form warning |
| Mobile, PWA | 360 px checks, installable manifest |
| Upload limits, type by content | upload tests (00 §7) |
| HTTPS, role + assignment checks, XSS sanitisation, signed URLs, audit log | security tests per module, `npm audit`, CSP |
| Privacy (private fields only to student + Admin) | JSON snapshot tests of teacher/public views |
| Backups 30 days | §4 script |
| UTC stored, Asia/Dhaka shown | time utils tests (date boundaries at 18:00 UTC) |
| Bangla content everywhere | Unicode tests for search, banned words, CSV import, PDF export fonts (embed a Bangla font, e.g. Noto Sans Bengali, in pdfkit) |
| Accessibility | keyboard pass on login, forms, exam page; axe check |

## 7. Test plan summary

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | permissions helpers, grading, ranks, attendance %, generator logic, time utils, URL parsers, banned-word matcher |
| API integration | Vitest + supertest + real Postgres | each module's **Tests** list, allow AND deny per role |
| E2E | Playwright, 360 × 740 | landing → login → complete profile; teacher takes attendance; student takes exam to auto-submit; chat send/receive; book unlock |
| Security | custom tests | RLS enabled on all tables; no `correct` in exam payloads before reveal; no private fields in public/teacher views; CSRF header required |

CI (GitHub Actions, free): install, typecheck, lint, test (with a Postgres service container), `spec:check --strict` for finished milestones, build.

## 8. Acceptance

- **OPS-01** `GET /api/health` needs no login, runs `SELECT 1` and returns only `ok`.
- **OPS-02** The server refuses to start with a clear message when a required env var is missing.
- **OPS-03** Every job handler is idempotent (running it twice changes nothing) and works when run late.
- **OPS-04** Security headers and CSP are set as in §3; only `NEXT_PUBLIC_*` values reach the browser.
- **OPS-05** Load: 500 students taking an exam → p95 answer save under 300 ms with no errors.
- **OPS-06** Load: 200 chat sockets → p95 delivery under 1 s.
- **OPS-07** Feed first page loads in under 2 s on throttled 4G (Lighthouse mobile).
- **OPS-08** The backup script creates a dump, removes dumps older than 30 days, and a restore into an empty DB works.
- **OPS-09** CI runs typecheck, lint, tests, spec-check and build on every push.
- **OPS-10** PDF exports render Bangla text correctly.
- **OPS-11** The purge job deletes storage objects 30 days after delete and never before.
