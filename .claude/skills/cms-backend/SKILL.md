---
name: cms-backend
description: Build or change College Management System API in apps/api (Express, Zod, Prisma, modules under /api/<module>). Use for routes, services, validation and error handling.
---

# CMS backend

Read the PRD section for the feature, `tech.stack.md` §3-4, and `PRD.md` §4.6 and §8.

## Module layout
`apps/api/src/modules/<module>/` with `routes.ts`, `service.ts` and schemas (import from `packages/shared`). Modules: auth, users, academics, schedule, attendance, feed, chat, notices, notifications, classes, materials, exams, books, ai, admin.

## Every route
1. Authenticate (session middleware).
2. Check role AND assignment (see `cms-auth-permissions`).
3. Validate body/query/params with Zod from `packages/shared`.
4. Call a service; routes stay thin.
5. Return a consistent JSON shape and status codes; never leak stack traces or other users' data.

## Rules
- Multi-step writes in `prisma.$transaction`. Parameterised queries only.
- Times UTC `timestamptz`; paginate every list endpoint.
- Rate-limit auth, AI, upload and chat-send routes.
- Log with pino; never log passwords, tokens or the Groq key.
- `GET /api/health` runs `SELECT 1` and returns `ok` (keep-awake ping).
- Secrets only in server env.

## Done when
Type-check, lint and tests pass; permission tests cover allowed AND denied roles.
