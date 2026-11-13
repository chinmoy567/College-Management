---
name: spec-check
description: Test and verify that a spec in docs/spec/ is properly built - runs type-check, lint, unit/API tests and Playwright, checks each Acceptance ID in code and in the running website at phone width, adds missing tests, and reports pass/fail per ID. Usage - /spec-check 04, /spec-check 02 05, or /spec-check all. Use after finishing any milestone or spec.
argument-hint: "<spec number(s) like 04 | all>"
---

# /spec-check — verify specs are built correctly

Arguments: `$ARGUMENTS` (spec numbers such as `04`, several like `02 05`, or `all`). With no argument, ask which spec, suggesting the one for the milestone just finished.

## Spec map

| No. | File | ID prefix | Milestone |
|---|---|---|---|
| 00 | `docs/spec/00-conventions.md` | CONV | M0 |
| 01 | `docs/spec/01-database.md` | DB | M1 |
| 02 | `docs/spec/02-auth.md` | AUTH | M2 |
| 03 | `docs/spec/03-academics-accounts.md` | ACAD | M3 |
| 04 | `docs/spec/04-schedule-attendance.md` | SCH | M5 |
| 05 | `docs/spec/05-exams-progress.md` | EXAM | M7 |
| 06 | `docs/spec/06-community.md` | COMM | M8 |
| 07 | `docs/spec/07-chat-notices-notifications.md` | CHAT | M9 |
| 08 | `docs/spec/08-learning-content.md` | LRN | M6 |
| 09 | `docs/spec/09-bookshop-ai.md` | BOOK, AI | M10 |
| 10 | `docs/spec/10-frontend.md` | FE | M4 |
| 11 | `docs/spec/11-jobs-ops.md` | OPS | M12 |

Some IDs can only pass in a later milestone (each plan in `docs/implementation/` lists when): spec 00 is complete at M6/M12, spec 10 grows with every milestone and is complete at M12, spec 11 starts at M0 and is complete at M12, and a few IDs in 03/04/06 finish in M6/M7/M9/M11. When checking at a milestone, report those IDs as ⛔ not built **with the milestone they belong to**, and call the spec "complete for this milestone" if everything else passes; say "Spec NN is complete" only when every ID passes.

## Steps

1. **Preflight (once):** if there is no `package.json` / `apps/` yet, report that nothing is built and that M0 comes first, then stop. Otherwise run `npm run typecheck` and `npm run lint` once and keep the result.
2. **Launch one `spec-verifier` agent per requested spec.** For `all` or several specs, launch them in parallel, except that only one agent at a time may run the dev server and Playwright: tell the first agent to do the website checks for all requested specs, or run the (UI) parts one after another. Give each agent: the spec file, its ID prefix, and the preflight result.
3. **Combine the results** into one summary in chat:
   ```
   /spec-check results
   | Spec | Pass | Fail | Test added | Not built | Unverified |
   | 02 Auth | 12 | 1 | 1 | 0 | 0 |
   ```
   Then every ❌ fail with file:line, then PRD/security problems, then ⛔ not-built IDs grouped by spec.
4. **Verdict:** "Spec NN is complete" only when every ID is ✅ or ⚠ (test added and passing) and type-check, lint and all tests pass. Otherwise list exactly what is left.
5. Offer to fix the ❌ bugs (that is normal development work, done after the check, with its own commit).

## Rules
- Report in chat only. No report files in the repo (CLAUDE.md). Screenshots only in the gitignored `test-results/`.
- Never report client decisions in `.claude/CLAUDE.md` as problems.
- Never claim a pass that was not run. If something could not be checked (app won't start, no DB), say so.
- Agents may commit and push new tests; confirm each push succeeded.
