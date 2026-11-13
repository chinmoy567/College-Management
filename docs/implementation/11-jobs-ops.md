# Plan 11 · Background Jobs, Configuration, Deployment & Quality (M0 base, M12 launch)

Spec: `docs/spec/11-jobs-ops.md` · PRD §8, §9, tech.stack §3, §7–9. Agents: `realtime-builder` (jobs), `deploy-engineer`. Skills: `cms-realtime-jobs`, `cms-deploy-cloud`, `cms-performance-pwa`, `cms-load-test` (§5 load checks).

## 1. What is built when

| Part | Milestone |
|---|---|
| pg-boss bootstrap, config validation, health, helmet/CSP skeleton, `render.yaml`, CI | M0 |
| `email.send` | M2 |
| `meetings.generate` | M5 |
| `online_class.*`, `storage.purge`, `material.extract_text` | M6 (extract text body may land in M10) |
| `exam.*` | M7 |
| `pin.expire` (optional cache clear) | M8 |
| `notice.publish`, `push.send` | M9 |
| `book.make_preview` | M10 |
| `housekeeping`, boot catch-up, load tests, backups, PWA, uptime monitor, first cloud deploy, NFR checklist | M12 (first demo deploy can happen right after M4) |

## 2. Job framework (M0)

- `jobs/index.ts`: `PgBoss({ connectionString: DATABASE_URL, schema: 'pgboss', max: 3 })` (session pooler; RLS loop runs on `public` only, pg-boss schema not exposed via Supabase REST — verify in Supabase API settings that only `public` is exposed).
- `registerJob(name, handler, { teamSize, retryLimit, retryBackoff, singletonKey? })`. Handlers receive validated payloads (Zod) and must be **idempotent and late-safe** (OPS-03): each handler test runs the job twice and asserts the same DB state, and once with "now" far past the scheduled time.
- Crons via `boss.schedule(name, cron, data, { tz: 'Asia/Dhaka' })`: `meetings.generate` 00:30, `storage.purge` 03:00, `housekeeping` 03:30, `pin.expire` hourly. On boot: run `meetings.generate` for `[today, today+14]` and finalise expired exam attempts once (the server may have slept).
- Graceful shutdown order: stop HTTP accept → `io.close()` → `boss.stop({ graceful: true })` → `prisma.$disconnect()`.

## 3. Server hardening (M0, verified M12)

- **CSP with Next.js**: `default-src 'self'` breaks Next's inline bootstrap scripts. Plan: Express generates a per-request nonce, sets `res.locals.nonce`, passes it to Next via the `x-nonce` request header; root layout reads it (`headers()`) and Next applies it to its scripts; `script-src 'self' 'nonce-…' 'strict-dynamic'`. Dev mode allows `'unsafe-eval'` only when `NODE_ENV=development`. Other directives exactly as spec §3 (Supabase domain in `img-src`/`connect-src`, `frame-src` youtube-nocookie + drive, `connect-src wss:`). Test asserts the header (OPS-04).
- `trust proxy 1`; HSTS from helmet; `express.json({ limit: '1mb' })`; compression off for SSE routes.
- **Only `NEXT_PUBLIC_*` in the browser**: build test greps `.next/static` for every non-public env name/value from `.env.example` (OPS-04, AI-08).

## 4. First cloud deploy (right after M4, repeated each milestone)

Following `cms-deploy-cloud`: Supabase project (Mumbai/Singapore), buckets `public` + `private`, run migrations with `DIRECT_URL`, seed Admin; Render free web service from `render.yaml`, env vars set in the dashboard, health check `/api/health`; UptimeRobot every 10 min. Smoke: login as Admin → TOTP setup on the live URL. A live demo early catches Render/Supabase surprises (SMTP blocking, memory) long before launch.

## 5. M12 — hardening & launch

1. **Load test — exams** (k6, free): script logs in 500 seeded students (pre-created sessions to keep argon2 out of the measurement), starts within 2 min, saves an answer every 20 s for 45 min. Pass: p95 < 300 ms, 0 errors, pooler connections within limit. Tune Prisma `connection_limit` (~10), check the answer-save SQL plan (`EXPLAIN ANALYZE`), check Render memory (OPS-05).
2. **Load test — chat**: 200 socket.io-client connections, 1 msg/s spread, measure send→receive p95 < 1 s (OPS-06).
3. **Feed**: Lighthouse mobile on throttled 4G, first page < 2 s; fix with image `sizes`, signed URL batching, skeleton-first render (OPS-07).
4. **Groq**: 50 concurrent questions against the real API, confirm the busy message path.
5. **Email**: confirm Gmail SMTP from Render; if blocked, document "demo uses logged links" (tech.stack §7).
6. **PWA** (`cms-performance-pwa`): `manifest.webmanifest` (192/512 icons, standalone), service worker: push handler (07) + offline shell; **`fetch` handler never caches `/api/*`** (FE-09).
7. **Backups**: `scripts/backup.sh` per spec §4 + restore notes; tested by dumping and restoring into an empty local DB (OPS-08).
8. **Bangla PDF**: one shared `pdf/createDoc()` registering Noto Sans Bengali; test renders a known Bangla string and extracts it back with pdfjs (OPS-10). Note: pdfkit doesn't shape complex scripts perfectly — verify conjuncts visually; if broken, switch the Bangla-heavy exports to HTML → print-to-PDF in the browser.
9. **NFR checklist** (spec §6) walked row by row and reported in chat.
10. `/spec-check all` → everything complete → launch demo.

## 6. Acceptance → tests

| ID | Test | When |
|---|---|---|
| OPS-01 | `[OPS-01] health no auth, SELECT 1, body ok only` | M0 |
| OPS-02 | `[OPS-02] boot fails with clear message on missing env` (spawn child process) | M0 |
| OPS-03 | `[OPS-03] <job> idempotent and late-safe` (one per job) | grows each milestone, complete M12 |
| OPS-04 | `[OPS-04] security headers/CSP; only NEXT_PUBLIC in bundle` | M0 / M12 |
| OPS-05 | `[OPS-05] 500 exam takers p95 < 300 ms` (k6 script; test file wraps the summary JSON check) | M12 |
| OPS-06 | `[OPS-06] 200 sockets p95 < 1 s` | M12 |
| OPS-07 | `[OPS-07] feed first page < 2 s throttled 4G` (Lighthouse CI) | M12 |
| OPS-08 | `[OPS-08] backup dump, 30-day prune, restore works` | M12 |
| OPS-09 | `[OPS-09] CI runs typecheck/lint/test/spec-check/build` (workflow file assertion) | M0 |
| OPS-10 | `[OPS-10] PDF exports render Bangla` | M11/M12 |
| OPS-11 | `[OPS-11] purge deletes after 30 days, never before` (fake clock) | M6 |

Load tests are not run in normal CI (too slow, free minutes); they run on demand against a dedicated environment, and their `[OPS-05]`/`[OPS-06]` tests read the stored k6 summary so `spec:check` still finds the IDs.

## 7. Definition of done (M12)

NFR checklist in spec §6 is green; `/spec-check all` reports every spec complete; the live Render URL passes the smoke test at 360 px.
