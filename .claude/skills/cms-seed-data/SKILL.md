---
name: cms-seed-data
description: Create deterministic, fake seed data for the College Management System (one Admin, teachers incl. Section Mentors, students, sessions, sections, routine, exams, posts) for development, tests and demos. Use when the dev DB needs realistic data.
---

# Seed data

- Seed script in `/prisma` (or `apps/api`), idempotent: safe to run repeatedly.
- One Admin account only. Fixed, documented dev passwords for non-production only; never seed these in production.
- Fake names and fake contact info only; no real personal data. Include students under 18 (minors) via DOB.
- Cover each PRD role (Admin, Teacher, Student; there is no Parent role), a Section Mentor, several sessions/groups/sections, a week of routine with a holiday, a cancelled meeting, an open and a finished exam, attendance rows, posts, notices and chat messages.
- Use fixed IDs/dates relative to a fixed clock so tests are repeatable; times stored UTC.
- Scripts (plans 00/01): `npm run db:seed` (Admin + Settings, production-safe) and `npm run db:seed:demo` (`prisma/seed-demo.ts`, dev/test only: 1 session, 3 groups, 2 sections, 5 courses, 3 teachers, 60 students).
- Run it on a fresh DB and confirm the app and tests work against it.
