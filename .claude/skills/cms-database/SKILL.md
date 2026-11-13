---
name: cms-database
description: Change the Prisma schema, write migrations, seed data or query PostgreSQL on Supabase for the College Management System. Use for any data-model change.
---

# CMS database

Source: `docs/PRD.md` §6 (data model), `docs/spec/01-database.md` (full schema, raw SQL, settings, seed), `docs/implementation/01-database.md` and `docs/tech.stack.md` §4.

- Every change is a Prisma migration in `/prisma`; never edit the DB by hand. Review the generated SQL before applying.
- `DATABASE_URL` = Supabase session pooler (5432); `DIRECT_URL` = direct, used only by `prisma migrate`.
- Supabase is only Postgres + Storage. No Supabase Auth, Realtime or REST. Enable Row Level Security with NO policies on every table (new tables too) so the anon key reads nothing.
- Times are `timestamptz` in UTC. Use integers or Decimal for marks, not floats.
- Index foreign keys and common filters (course, section, student, date). Add unique constraints for business rules (one attendance row per student + meeting, one answer per question + attempt).
- Keep history where it matters (pass-out students, attendance, results); cascade deletes only when safe.
- Destructive migrations (drop/rename column) need a data-preserving plan; tell the user and recommend a `pg_dump` first (the free plan has no backups).
- Free plan is about 500 MB: no files or large blobs in tables.
- After a schema change, check it against the PRD and tell the user briefly in chat.
