---
name: cms-debug
description: Systematic debugging for the College Management System - reproduce, find root cause, fix, add a regression test. Use when something is broken or a test fails and the cause is unknown.
---

# Debug

1. Reproduce with a failing test, request or browser steps. If not reproducible, say so.
2. Read the error, logs (pino output), network requests and console. Find the exact failing line.
3. Check the usual suspects: UTC vs Asia/Dhaka time, missing role/assignment check, Prisma pooler vs direct URL, session cookie not sent, stale TanStack Query cache, pg-boss job not running (Render asleep).
4. Confirm root cause with evidence, then make the smallest fix.
5. Add a regression test that fails before and passes after.
6. Check neighbouring code for the same bug; run the full suite; report cause, fix and what you verified.
