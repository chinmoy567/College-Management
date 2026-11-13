---
name: cms-load-test
description: Run the load and launch checks for the College Management System - 500 concurrent exam takers, 200 chat sockets, feed speed on throttled 4G and Groq concurrency - and report against the targets in docs/spec/11-jobs-ops.md §5. Use before launch (M12) or after changes to exams, chat, feed or the database pool.
---

# Load and launch checks

Source: `docs/spec/11-jobs-ops.md` §5-6 (OPS-05, OPS-06, OPS-07), PRD §8, `docs/implementation/11-jobs-ops.md` §5. Free tools only (k6, autocannon, socket.io-client, Lighthouse).

## Rules
- **Never load-test the shared live demo without asking the user.** Use a separate environment (local production build or a separate free Supabase/Render project). Free plans have limits; say which environment you used.
- Use seeded fake accounts only (`npm run db:seed:demo` or a load seed with 500 students). Create login sessions before the test so argon2 login cost is not part of the measurement.
- Never put real secrets in scripts; read them from env.

## Tests
| Check | Script | Pass |
|---|---|---|
| Exam (OPS-05) | `load/exam.k6.js`: 500 virtual students start one exam within 2 min, save an answer every 20 s for 45 min, submit | p95 answer save < 300 ms, 0 errors, DB connections within the pooler limit |
| Chat (OPS-06) | `load/chat.ts`: 200 socket.io-client connections in shared conversations, 1 message/s spread | p95 send → receive < 1 s |
| Feed (OPS-07) | Lighthouse mobile, throttled 4G, logged-in feed first page | load < 2 s |
| Groq | 50 concurrent AI questions against the real API (ask the user first; it uses the free quota) | busy message shown on 429, count refunded |

## While it runs
Watch: Render/Node memory (free plan ~512 MB), Prisma pool waits, slow-query log (> 200 ms), pg-boss backlog, Supabase connection count.
If a target fails: `EXPLAIN ANALYZE` the hot query, check indexes, tune Prisma `connection_limit` (~10) and pg-boss `max`, cache the exam snapshot, then re-run.

## Report
Save the k6/Lighthouse summary JSON under the gitignored `test-results/load/` so the `[OPS-05]`/`[OPS-06]`/`[OPS-07]` tests can read it. Report in chat: environment, numbers vs targets, bottleneck found, fix made. Never claim a run that did not happen.
