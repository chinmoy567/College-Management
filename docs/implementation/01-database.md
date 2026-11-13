# Plan 01 · Database (Milestone M1)

Spec: `docs/spec/01-database.md` · PRD §6 · tech.stack §4. Agent: `db-architect`. Skill: `cms-database`.
Goal: the complete schema in one go, so later milestones add code, not tables.

## 1. Why the whole schema now

Every module references `User`, `Section`, `CourseOffering`, `StorageObject`. Building the full model in M1 lets us review the PRD §6 coverage once (DB-06), place all hand-written constraints in the first migration, and avoid a chain of risky ALTERs later. Later milestones may still add migrations, but only for gaps found during build.

## 2. Steps

1. **Transcribe the schema** from spec §2 into `prisma/schema.prisma`, adding `@@map` (snake_case plural) and `@map` on every field. Review relations: every FK gets an explicit `onDelete` (`Restrict` by default; `Cascade` only for pure children — `AIMessage`, `PostMedia`, `ConversationMember`, `ExamQuestion`, `Answer`, `NoticeRecipient`).
2. **Indexes** for the hot paths (add as `@@index`):
   - `login_sessions(token_hash)` unique; `enrollments(student_id, status)`; `class_meetings(date, status)`; `attendance_records(student_id, course_offering_id)`;
   - `posts(status, created_at desc)`, `posts(pinned_until)`; `post_views(user_id, post_id)` unique;
   - `messages(conversation_id, created_at)`; `notifications(user_id, read_at, created_at)`;
   - `answers(attempt_id, exam_question_id)` unique (hot path for 500 concurrent takers);
   - `notice_recipients(user_id, notice_id)` unique; `rate_limit_hits(key, created_at)`.
   - `pg_trgm` GIN on `student_profiles.name` and `users.login_id` for Student 360° search (03 §7).
3. **Generate the first migration** with `prisma migrate dev --create-only`, then append the raw SQL from spec §3 into the same `migration.sql`:
   - CHECKs, partial unique indexes, expression index on `class_meetings (routine_slot_id, COALESCE(original_date, date))`, `special_days NULLS NOT DISTINCT` (needs PG 15 — Supabase is 15+; local Docker image pinned to 15).
   - `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
   - `material_chunks.tsv` generated column + GIN.
   - RLS loop. Then a **second migration** `rls_guard` with an event trigger is *not* used (Supabase restricts event triggers); instead every future migration ends with the same RLS loop (documented in `prisma/README.md`) and `db.rls.test.ts` catches any miss (DB-02).
4. **Prisma vs raw SQL drift:** Prisma does not know partial/expression indexes. Mark them in the schema with `/// raw: see migration` comments, and never let `prisma migrate dev` drop them — CI runs `prisma migrate diff --from-migrations --to-schema-datamodel` and fails if the diff tries to drop the raw indexes.
5. **Seed** `prisma/seed.ts` (idempotent, uses `upsert`):
   - Settings keys §4 with defaults (DB-05). `ai_model`: confirm a current free Groq Llama 70B-class model id at build time.
   - Single Admin from env; if an Admin exists with another email → throw (DB-04). Password argon2, `mustChangePassword=true`.
   - `SEED_DEMO=true` → periods.
   - `prisma/seed-demo.ts` (dev/test only): uses factories; 1 session, 3 groups, 2 sections, 5 courses, 3 teachers, 60 students, fixed passwords printed to console. Deterministic (seeded faker).
6. `prisma/README.md`: how to add a migration with raw SQL, the RLS rule, `DATABASE_URL` vs `DIRECT_URL`.

## 3. Schema gaps found while planning (add in M1, and update spec 01 §2 in the same commit)

Other specs need these columns, but the schema in spec 01 §2 does not list them. They are implementation details (no PRD rule changes):

| Needed by | Column | Why |
|---|---|---|
| 02 §3 TOTP replay protection | `User.totpLastStep Int?` | "Reject the same time-step twice" needs the last accepted step stored |
| 02 §3 "5 wrong codes → session revoked" | `LoginSession.totpFailures Int @default(0)` | Counter per step-up session |
| 02 §3 TOTP setup "stores encrypted (pending)" | `User.totpPendingSecretEnc String?` | Secret before `enable`, so a half-finished setup never replaces an active one |
| 04 §6.1 "Idempotent by `clientDraftId`" | `ClassMeeting.lastClientDraftId String?` | Detect a repeated submit of the same draft |
| 03 §5.1 Login ID `S-<year>-<seq>` / `T-<seq>` | counter rows in `Setting` (`login_seq:S-2024`, `login_seq:T`), locked `FOR UPDATE` | No new table needed; documented so it isn't invented twice |

## 4. Things to get right (senior notes)

- **Decimal marks:** Prisma returns `Prisma.Decimal`; add a shared `toNumber2()` serialiser so JSON never shows strings in some places and numbers in others.
- **`date` columns:** Prisma maps `@db.Date` to JS `Date` at UTC midnight. All conversion goes through `lib/time.ts` (`dateOnly('2026-11-14')`) to avoid off-by-one around Dhaka midnight.
- **`time` columns** for periods: `@db.Time` → keep as `HH:mm` strings at the service boundary.
- **`ON CONFLICT` with the expression index** (meeting generator, 04) must use raw SQL: `ON CONFLICT (routine_slot_id, (COALESCE(original_date, date))) WHERE routine_slot_id IS NOT NULL DO NOTHING`. Note it in the schema comment.
- **Cuid ids** everywhere; no autoincrement leaks (login IDs are separate, generated in 03).
- **Soft delete columns** (`deleted_at`) are indexed only where queried often (sections, routine slots, periods, rooms).
- Keep the DB small (500 MB free): no blobs, `integrityLog` capped at 500 entries, `RateLimitHit` purged nightly.

## 5. Acceptance → tests

| ID | Test |
|---|---|
| DB-01 | `[DB-01] migrate deploy + seed on empty DB, seed twice = no change` — integration: reset DB, run seed twice, compare row counts and `updated_at`. |
| DB-02 | `[DB-02] RLS on every public table` — `db.rls.test.ts` queries `pg_class.relrowsecurity` for **every** table in `public`, including `_prisma_migrations` (Supabase would expose it otherwise). pg-boss lives in its own `pgboss` schema, which is not exposed to the Supabase REST API. |
| DB-03 | `[DB-03] <constraint> rejects bad data` — one `it` per constraint listed, each expecting the Postgres error code (`23514` check, `23505` unique). |
| DB-04 | `[DB-04] seed never creates a second admin` |
| DB-05 | `[DB-05] all settings keys seeded with defaults` — compares against a table exported from `packages/shared/settings.ts` (single source of the key list). |
| DB-06 | `[DB-06] PRD §6 entities exist` — a static test listing PRD §6 entity names → Prisma DMMF model names. Reviewed manually once against PRD §6. |

## 6. Definition of done (M1)

`prisma migrate deploy` + seed run on a clean local DB **and** on the Supabase dev project; `/spec-check 01` complete; schema reviewed against PRD §6 in chat (CLAUDE.md review rule).
