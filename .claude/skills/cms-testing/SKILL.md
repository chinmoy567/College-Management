---
name: cms-testing
description: Write unit, API (supertest) and Playwright tests for the College Management System, named by Acceptance ID, with seeded data and permission-denial cases. Use when adding or fixing tests.
---

# Testing

- Name every test `[ID] description` using the Acceptance IDs in `docs/spec/` (`docs/spec/00-conventions.md` §9).
- Layers: unit (pure logic: scoring, schedule generation, permissions), API (supertest against a test DB), E2E (Playwright, 360 px first).
- Each API route: happy path, validation error, wrong role, wrong class/assignment, logged out.
- Deterministic: seeded data, fixed clock (Asia/Dhaka vs UTC cases), no sleeps, independent tests, clean up.
- Never weaken or delete a test to get green. Find whether code or test is wrong.
- Run type-check, lint and the full suite; report counts and failure output plainly.
