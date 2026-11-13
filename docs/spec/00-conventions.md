# 00 · Conventions

Applies to every module. Stack: `docs/tech.stack.md`.

## 1. Repo layout

```
/apps
  /web                      Next.js App Router (frontend only)
    /src/app                routes (see 10-frontend.md)
    /src/components         ui/ (shadcn copies), shared/, feature folders
    /src/lib                api client, query keys, socket client, date utils
  /api                      Express + Socket.IO + pg-boss
    /src/server.ts          creates Express, mounts /api, Socket.IO, then Next handler
    /src/config.ts          reads and validates env with Zod (fail fast on boot)
    /src/db.ts              single PrismaClient
    /src/middleware/        session, requireRole, rateLimit, errorHandler, upload
    /src/lib/               permissions.ts, storage.ts, mail.ts, audit.ts, time.ts, push.ts
    /src/modules/<module>/  routes.ts · service.ts · (policy.ts) · *.test.ts
    /src/jobs/              pg-boss setup + one file per job
    /src/realtime/          socket auth, rooms, event handlers
/packages/shared            Zod schemas, enums, constants, shared types
/prisma                     schema.prisma, migrations/, seed.ts
render.yaml  .env.example  package.json (workspaces)
```

Modules: `auth, users, academics, schedule, attendance, feed, chat, notices, notifications, classes, materials, exams, books, ai, admin, files`.

## 2. Code rules

- TypeScript `strict`. No `any` at module boundaries.
- Routes are thin: authenticate → authorize → validate (Zod) → call service → respond.
- Services hold business rules and receive an `actor` (`{ id, role, ... }`) argument; they never read `req`.
- Multi-step writes use `prisma.$transaction`. Use `Serializable` or row locks (`SELECT ... FOR UPDATE` via `$queryRaw`) where a limit must hold under concurrency (section 30-student limit, exam attempt start, AI daily count).
- Every Admin write calls `audit(actor, action, targetType, targetId, changes)` inside the same transaction (no personal data in `changes`, PRD §6 AuditLog).
- Constants (30 students, 7-day pin, 10 images, duration presets, upload limits) live in `packages/shared/src/constants.ts`.

## 3. API shape

- Base path `/api/<module>`. JSON only (except uploads: `multipart/form-data`; exports: file download).
- Success: `200/201` with the resource or `{ items, nextCursor }` for lists.
- Error body (always):
  ```json
  { "error": { "code": "SECTION_FULL", "message": "This section already has 30 students.", "fields": { "sectionId": "..." } } }
  ```
- Status codes: `400` validation (`VALIDATION_ERROR`, per-field messages), `401` no/invalid session, `403` role/assignment denied (`FORBIDDEN`), `404` not found **or not visible to the actor** (prefer 404 over 403 for objects the actor should not know exist), `409` business conflict (`SECTION_FULL`, `EXAM_LOCKED`, `ATTEMPT_IN_PROGRESS`), `410` expired token, `429` rate limited, `500` generic (no stack traces).
- **Pagination:** cursor-based. Query `?cursor=<opaque>&limit=<1..50>` (default 20). Feed uses 20 (PRD §8).
- IDs: `cuid()` strings in URLs. Login IDs (Student ID) are never used as path keys.
- Dates in responses: ISO 8601 UTC. Date-only values (holiday, attendance date) as `YYYY-MM-DD` meaning the Asia/Dhaka calendar date.
- Validation schemas live in `packages/shared/src/schemas/<module>.ts` and are imported by both the API and the forms.

## 4. Authentication & authorization

- `sessionMiddleware` (all `/api` routes except public ones) reads the cookie, hashes the token, loads `LoginSession` + `User`, rejects if revoked/expired or `user.status != active`. Sets `req.actor`.
- Public routes: `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/login/totp`, forgot/reset password, verify email, `GET /api/public/*` (landing page).
- Users with `first_login = true` may only call `/api/auth/*` and `/api/me/complete-profile` (`FIRST_LOGIN_REQUIRED` 403 otherwise).
- Admin without TOTP set up may only call TOTP setup routes.
- **Policy helpers** (`apps/api/src/lib/permissions.ts`), each unit-tested for allow and deny:

| Helper | True when |
|---|---|
| `isAdmin(actor)` | role = admin |
| `teachesOffering(actor, offeringId)` | `CourseOffering.teacher_id = actor.id` |
| `mentorsSection(actor, sectionId)` | `Section.mentor_teacher_id = actor.id` |
| `teachesInSection(actor, sectionId)` | actor teaches any offering of the section |
| `canManageOffering(actor, offeringId)` | admin, or teaches it, or mentors its section (only where the PRD matrix gives mentors that right, e.g. recordings/notes "own section") |
| `isEnrolled(studentId, offeringId)` | an `active` Enrollment exists |
| `canTakeAttendance(actor, meetingId)` | admin, meeting teacher, substitute, or mentor of a covered section |
| `canSeeStudentPrivate(actor, studentId)` | admin or the student themself (PRD §8 Privacy) |

- Role-based UI hiding is cosmetic; the API is the guard.

## 5. Time

- Store `timestamptz` UTC. Date-only columns are Postgres `date` holding the **Asia/Dhaka** calendar date.
- Period `start_time`/`end_time` are `time` (local Dhaka wall clock). Dhaka has no DST, so `local = UTC+06:00` always; still use `date-fns-tz` everywhere (`lib/time.ts`: `dhakaDate(now)`, `toUtc(date, time)`, `formatDhaka(ts)`).
- Weekday for routine: computed from the Dhaka date.

## 6. Validation & sanitisation

- All body/query/params through Zod; unknown keys stripped (prevents mass assignment).
- Text limits: post 5,000 chars, comment 2,000, message 4,000, notice body 20,000, AI prompt 4,000.
- Rich text (notices only) is stored as sanitised HTML (allow-list via `sanitize-html`); everything else is plain text, rendered escaped; links auto-linked on render with `rel="noopener noreferrer nofollow"`.

## 7. Files (Supabase Storage)

- Upload route: `multer.memoryStorage()` with per-route size limit → `file-type` on the buffer → allow-list check → images through `sharp` (rotate, max 1600 px long edge, WebP q80, strip metadata) → upload with key `<purpose>/<yyyy>/<mm>/<cuid>.<ext>` (never the user's filename) → `StorageObject` row.
- Limits (PRD §8): images 5 MB (JPG/PNG/WebP), documents 20 MB (PDF/DOC/DOCX/PPT/PPTX), book PDF 50 MB (Admin only), 10 images per post/comment.
- Buckets: `public` (logo, banner, landing notice attachments, book covers) and `private` (everything else).
- Reading: services return `signedUrl(objectId, { expiresIn: 300, download?: filename })` only after the permission check for the owning resource. Public bucket files return a plain public URL.
- Delete: set `StorageObject.deleted_at`; nightly job removes the object from storage 30 days later (PRD §8). Files are never overwritten.
- Storage must be on the Supabase domain (separate origin from the app, PRD §4.6). Office documents are served as download (`Content-Disposition: attachment`).

## 8. Logging & errors

- pino JSON logs with request id. Redact `password`, `token`, `cookie`, `authorization`, `totp`, `GROQ_API_KEY`, `SMTP_PASS`.
- Never log message, post or AI chat content.

## 9. Testing

- Vitest for unit + integration (API tests with supertest against a disposable Postgres; `prisma migrate reset` per run).
- Playwright for a few critical end-to-end paths at 360 × 740 viewport (login, take attendance, take exam, chat send).
- Required test areas per module are listed in each spec under **Tests**.
- `npm run typecheck`, `npm run lint`, `npm test` at the root run all workspaces.
