---
name: cms-realtime-jobs
description: Build Socket.IO chat/notifications and pg-boss background jobs (exam auto-submit, email queue, Class Meeting generation, scheduled notices, pin expiry) for the College Management System.
---

# CMS realtime and jobs

Source: `docs/PRD.md` §5.8 messaging, §5.10 notifications, §5.17 routine, `docs/tech.stack.md` §3.

## Socket.IO
- Single server, no Redis. Authenticate with the session cookie on connect; reject otherwise.
- Authorize each event and room join by role + assignment (chat membership, course/section). Never trust ids in the payload.
- Persist first (DB), then emit. Clients refetch missed messages on reconnect.
- Validate payloads with Zod; rate-limit sends; cap message size.

## pg-boss (Postgres session-mode connection)
- Jobs: exam auto-submit, email queue, Class Meeting generation, scheduled notices, pin expiry.
- Handlers must be idempotent and safe to run twice or late (the free Render service may sleep; the keep-awake ping runs every 10 min).
- Exam correctness must NOT depend on a job: `deadline_at` is enforced on every answer and submit; the job is only cleanup.
- Email: queue + daily limit from Settings. If SMTP is blocked, write reset/verification links to the server log.
- Retries with backoff; log failures with pino.
