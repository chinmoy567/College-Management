# Plan 00 · Conventions & Scaffold (Milestone M0)

Spec: `docs/spec/00-conventions.md` · also `docs/tech.stack.md`, `docs/spec/11-jobs-ops.md` §2–3, §7.
Goal: a running skeleton where every later module drops in without touching the plumbing.

## 1. Outcome

- `npm run dev` serves the landing placeholder through Express → Next.js on one port.
- `GET /api/health` returns `ok` after `SELECT 1`.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run spec:check` all run from the root.
- CI on GitHub Actions runs the same on every push.

## 2. Steps

### 2.1 Workspace
1. Root `package.json` with npm workspaces: `apps/web`, `apps/api`, `packages/shared`. Node 20 LTS pinned in `engines` and `.nvmrc`.
2. `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` off — too noisy with Prisma). Path alias `@cms/shared`.
3. ESLint (flat config) + Prettier; `typescript-eslint` strict-type-checked for `apps/api`, Next lint rules for `apps/web`. Rule: no `any` in exported signatures.
4. Root scripts: `dev`, `build`, `start`, `typecheck`, `lint`, `test`, `test:e2e`, `spec:check`, `db:migrate`, `db:seed`.

### 2.2 `packages/shared`
- `src/constants.ts`: `SECTION_MAX = 30`, `PIN_DAYS_DEFAULT = 7`, `MAX_IMAGES = 10`, `EXAM_DURATIONS = [15,30,45,60,90,120] as const`, upload limits, text limits (00 §6), pagination defaults.
- `src/schemas/` one file per module (empty stubs now) + `common.ts`: `cursorQuery` (`limit` 1..50 default 20), `id` (cuid), `dhakaDate` (`YYYY-MM-DD`).
- `src/errors.ts`: the error-code union (`VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `SECTION_FULL`, …) shared by API and web.
- Build with `tsup` to ESM + CJS + d.ts so both Next and Express consume it.

### 2.3 `apps/api`
| File | Content |
|---|---|
| `config.ts` | Zod schema for every env var in 11 §2; `process.exit(1)` with a list of missing keys (OPS-02). |
| `db.ts` | Single `PrismaClient`, log slow queries > 200 ms at `warn`. |
| `server.ts` | `http.createServer(app)` → helmet → request id → pino-http → `express.json({limit:'1mb'})` → `/api` router → Socket.IO attach → `nextApp.getRequestHandler()`. `trust proxy 1`. Graceful shutdown. |
| `lib/http.ts` | `AppError(code, status, message, fields?)`, `asyncHandler`, `validate({ body, query, params })` middleware using Zod `.strip()` (CONV-02). |
| `middleware/errorHandler.ts` | Maps `AppError`, `ZodError` → 400 with `fields`, Prisma `P2002` → 409, `P2025` → 404; anything else → 500 generic, logged with stack server-side only (CONV-01). |
| `lib/pagination.ts` | `paginate(query, { cursor, limit })` — opaque base64url cursor of `(createdAt, id)`; returns `{ items, nextCursor }` (CONV-03). |
| `lib/time.ts` | `dhakaDate(now)`, `toUtc(date, time)`, `formatDhaka(ts)`, `weekdayOf(dhakaDate)` with `date-fns-tz` (CONV-07). |
| `lib/logger.ts` | pino with `redact` paths for `password`, `token`, `cookie`, `authorization`, `totp`, `code`, `backupCode`, `GROQ_API_KEY`, `SMTP_PASS`; request body logging **off** (CONV-06). |
| `lib/permissions.ts` | Signatures of all 8 helpers (00 §4); bodies filled in M2/M3. |
| `jobs/index.ts` | pg-boss start (after DB ready), `registerJob(name, handler, opts)`, `boss.stop()` on shutdown. |
| `modules/health/routes.ts` | `GET /api/health` → `SELECT 1` → `200 ok` (OPS-01). |

Module folder template (used by `cms-new-module`): `routes.ts` (authenticate → authorize → validate → service → respond), `service.ts` (takes `actor`, never `req`), `policy.ts` when rules are non-trivial, `*.test.ts`.

### 2.4 `apps/web`
- Next.js App Router, Tailwind (mobile-first), shadcn/ui init, `lib/api.ts` fetch wrapper (adds `X-Requested-With: cms`, parses the error shape), TanStack Query provider, placeholder landing page.
- `next.config` `output` default (served by Express via `next({ dev, dir })`), not standalone.

### 2.5 Testing tooling
- **Vitest** workspace config: `unit` (no DB) and `integration` projects. Integration uses a disposable Postgres 15: locally Docker `postgres:15`, in CI a service container. `globalSetup` runs `prisma migrate reset --force --skip-seed` once per run; each test file wraps work in a transaction or truncates touched tables (`TRUNCATE … CASCADE`) in `beforeEach`.
- `test/factories.ts`: `makeAdmin()`, `makeTeacher()`, `makeStudent({ sectionId })`, `loginAs(user)` → supertest agent with cookie + CSRF header. Grows with each milestone.
- **Playwright**: projects `phone` (360×740, default) and `desktop` (1280×800). `webServer` starts the app against the test DB with demo seed.
- `scripts/spec-check.ts`: parse `**PREFIX-NN**` from `docs/spec/*.md`, grep `[PREFIX-NN]` in `**/*.test.ts` and `e2e/**/*.spec.ts`, print covered/missing, `--spec NN`, `--strict`. `scripts/spec-check.config.json` lists finished milestones for CI strict mode.

### 2.6 CI (`.github/workflows/ci.yml`)
`npm ci` → `prisma generate` → typecheck → lint → `prisma migrate deploy` on service Postgres → `npm test` → `spec:check --strict` (finished specs only) → `npm run build`. Playwright in a separate job (cached browsers), allowed to run on `main` only to save free minutes.

### 2.7 Deploy skeleton
`render.yaml` (one free web service, build/start/health path from 11 §3), `.env.example` from tech.stack §9 + 11 §2.

## 3. Decisions a senior dev makes here

- **Errors are values, not strings:** codes live in `packages/shared` so the web shows the right message without string matching.
- **Zod `.strip()` everywhere** and services receive parsed DTOs only → mass-assignment is impossible by construction.
- **404 for invisible objects:** services expose `findVisibleOrThrow(actor, id)` helpers that throw `NOT_FOUND` when the policy fails (CONV-09).
- **One Next+Express process:** custom server means no Next middleware-only auth and no Vercel features; we accept that (tech.stack §1).

## 4. Acceptance → tests

| ID | Test (file) | When it can pass |
|---|---|---|
| CONV-01 | `[CONV-01] error shape for 400/404/409/500, no stack` — `errorHandler.test.ts` | M0 |
| CONV-02 | `[CONV-02] unknown keys stripped (role/status ignored)` — `http.test.ts` + per-module tests | M0 (helper), re-checked M3 |
| CONV-03 | `[CONV-03] list endpoints paginate default 20 max 50` — `pagination.test.ts` + a route-table test that walks every `GET` list route | M0 helper, full at M12 |
| CONV-04 | `[CONV-04] private file only via signed URL after check` — `storage.test.ts` | M6 |
| CONV-05 | `[CONV-05] random keys, no overwrite, purge after 30 days` | M6 (+ OPS-11) |
| CONV-06 | `[CONV-06] logs redact secrets and content` — capture pino stream | M0, re-checked M8/M9/M10 |
| CONV-07 | `[CONV-07] dhaka date at 18:00 UTC boundary` — `time.test.ts` | M0 |
| CONV-08 | `[CONV-08] <helper> allow/deny` — `permissions.test.ts` | M3 (all helpers exist) |
| CONV-09 | `[CONV-09] invisible object → 404` | M3 |

## 5. Definition of done (M0)

Spec 11 "M0 done when" line is met; CONV-01/02/06/07 pass; `/spec-check 00` reports the rest as "not built yet" with a clear milestone, and is re-run to complete at M6/M12.
