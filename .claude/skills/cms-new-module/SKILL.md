---
name: cms-new-module
description: Scaffold a complete feature slice for the College Management System - Prisma model, shared Zod schemas, Express module, permissions, web page and tests - from a spec in docs/spec/. Use when starting a new module.
---

# New module, end to end

1. Read the spec in `docs/spec/` and its Acceptance IDs; note the PRD sections it uses.
2. Database: model and migration (skill `cms-database`).
3. Shared: Zod schemas and types in `/packages/shared`.
4. API: `apps/api/src/modules/<name>` with routes, service, validation, role + assignment checks (skills `cms-backend`, `cms-auth-permissions`).
5. Web: pages and components, phone first (skill `cms-frontend`).
6. Tests named `[ID] ...` for every Acceptance ID (skill `cms-testing`).
7. Verify (skill `cms-verify`), then `/spec-check <number>` when the spec is done.
8. One topic per commit; push immediately after each.
