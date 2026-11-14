# Database (Prisma + PostgreSQL)

Spec: `docs/spec/01-database.md`. Plan: `docs/implementation/01-database.md`.

## Connection strings

| Variable | Used by | Value |
|---|---|---|
| `DATABASE_URL` | the running API (Prisma Client) | Supabase **session pooler** (port 5432) or local Postgres |
| `DIRECT_URL` | `prisma migrate` only | Supabase **direct** connection (migrations need a real session, not a pooler) |
| `SHADOW_DATABASE_URL` | `npm run db:drift` | an empty throwaway database, never the real one |
| `TEST_DATABASE_URL` | integration tests | a disposable Postgres 15 (each test run creates and drops its own database on that server) |

The service-role key and the DB password live only in the API's `.env`. They never go to the web app.

## Adding a migration

1. Edit `prisma/schema.prisma`.
2. `npx prisma migrate dev --create-only --name <what_changed>` (creates the SQL, does not apply it).
3. Open the new `migration.sql`. Add any raw SQL Prisma cannot express (CHECK constraints, partial unique
   indexes, expression indexes, `NULLS NOT DISTINCT`, trigram or tsvector indexes, generated columns).
4. **End the file with the RLS loop** (below), every time, even when you only added a column.
5. `npx prisma migrate dev` to apply it, then `npm run db:drift` and `npm test`.
6. Never edit a migration that has been applied anywhere; add a new one.
7. Mark raw objects in the schema with a `/// raw: see migration` comment next to the model they belong to.
   If a new raw index or column shows up in the drift check, add its exact `DROP` statement to
   `ALLOWED_RAW_DROPS` in `scripts/db-drift-check.ts` (Prisma lists such objects as "to drop").

Risky changes (drops, type changes, backfills) are done in two migrations: first add the new shape and
backfill, deploy, then remove the old shape in a later migration. Write the rollback note in the migration
header. Rollback is a new forward migration; never `migrate reset` a shared database.

## The RLS loop (end of every migration)

Supabase exposes every table in `public` through its REST API. We do not use that API, so every table has
Row Level Security **on with no policies**. New tables are not protected until this block runs:

```sql
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP; END $$;
```

It also covers `_prisma_migrations`. Supabase restricts event triggers, so there is no automatic guard;
`apps/api/src/db/db.rls.int.test.ts` fails if any table in `public` has RLS off. pg-boss uses its own
`pgboss` schema, which the REST API does not expose.

## Raw-SQL objects (not modelled by Prisma)

CHECK constraints (`sections_class_chk`, `reactions_target_chk`, `exams_*_chk`, `periods_time_chk`,
`holidays_range_chk`), partial unique indexes (`sections_name_uq`, `enrollments_active_uq`,
`attempts_inprogress_uq`, `class_meetings_slot_day_uq`), `special_days_uq` (`NULLS NOT DISTINCT`),
trigram indexes for Student 360 search, `material_chunks.tsv` + GIN index.

The meeting generator must use raw SQL with
`ON CONFLICT (routine_slot_id, (COALESCE(original_date, date))) WHERE routine_slot_id IS NOT NULL DO NOTHING`.

## Seeding

- `npm run db:seed` : the single Admin (from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`) and the Settings rows.
  Idempotent; throws if an Admin with a different email already exists.
- `npm run db:seed:demo` : adds deterministic fake demo data (development only). Never run it in production.
