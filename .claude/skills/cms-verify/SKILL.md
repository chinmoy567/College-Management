---
name: cms-verify
description: Verify a College Management System change before calling it done - type-check, lint, tests, phone-width check and a PRD review. Use after any meaningful change.
---

# CMS verify

1. From the repo root run type-check, lint and tests (npm workspaces). Fix failures; report any you cannot fix, with the output.
2. If a migration was added, apply it to a dev DB and confirm the app still starts.
3. UI change: run the app and check at 360 px (no horizontal scroll, 44 px targets, forms usable). Say plainly if you could not run it.
4. Meaningful change (PRD, schema/migrations, auth/permissions, API routes, exams, attendance, chat, file storage, AI chat): check it against `PRD.md` for contradictions, gaps, security and data-integrity problems, or use the `prd-checker` agent. Tell the user briefly in chat.
5. Do not write issue lists or detail files into the repo. Do not reopen client decisions in `.claude/CLAUDE.md`.
6. Commit only when asked: one topic per commit, message covers everything it does (including deletions), then `git push` immediately and confirm it succeeded.
