---
name: milestone
description: Run one build milestone (M0-M12) of the College Management System end to end - read the spec and its plan, build in the planned order, test every Acceptance ID, verify, run /spec-check, commit and push. Usage - /milestone M3. Use when starting or continuing a milestone.
argument-hint: "<milestone like M3>"
---

# /milestone — build one milestone end to end

Arguments: `$ARGUMENTS` (a milestone such as `M3`). With no argument, find the first milestone in `docs/spec/README.md` whose spec is not complete and suggest it.

## Milestone map

| M | Spec(s) | Plan | Main agent / skill |
|---|---|---|---|
| M0 | 00 (+ 11 base) | `docs/implementation/00-conventions.md`, `11-jobs-ops.md` §2-3 | `senior-developer` |
| M1 | 01 | `01-database.md` | `db-architect` / `cms-database`, `cms-seed-data` |
| M2 | 02 | `02-auth.md` | `auth-security` / `cms-auth-permissions` |
| M3 | 03 | `03-academics-accounts.md` | `api-builder`, `web-builder` / `cms-new-module` |
| M4 | 10 (shell) | `10-frontend.md` | `ui-designer`, `web-builder` / `cms-frontend` |
| M5 | 04 | `04-schedule-attendance.md` | `exam-attendance-builder` / `cms-exams-attendance` |
| M6 | 08 (+ files) | `08-learning-content.md` | `senior-developer` / `cms-files-ai` |
| M7 | 05 | `05-exams-progress.md` | `exam-attendance-builder` / `cms-exams-attendance` |
| M8 | 06 | `06-community.md` | `api-builder`, `web-builder` |
| M9 | 07 | `07-chat-notices-notifications.md` | `realtime-builder` / `cms-realtime-jobs` |
| M10 | 09 | `09-bookshop-ai.md` | `senior-developer` / `cms-files-ai` |
| M11 | Admin extras (03 §7, reports) | `README.md` "M11" | `senior-developer`, `web-builder` |
| M12 | 11 (launch) | `11-jobs-ops.md` §5 | `deploy-engineer` / `cms-deploy-cloud`, `cms-performance-pwa`, `cms-load-test` |

## Steps

1. **Check the start:** the milestones it depends on (`docs/spec/README.md`) are done. If one is not, say so and stop, unless the user says to go on.
2. **Read:** the spec, its plan in `docs/implementation/`, the PRD sections the spec names, the matching diagrams in `docs/architecture.md`, and the "cross-cutting pieces" table in `docs/implementation/README.md` (helpers this milestone must build early or extend).
3. **List the Acceptance IDs** of the spec and which of them the plan says can pass in this milestone.
4. **Build in the plan's order**, one topic at a time:
   shared Zod schemas and constants → migration (if any, via `db-architect`) → pure logic with unit tests → services and thin routes with API tests (allow AND deny per role) → jobs and socket events → screens at 360 px with loading/empty/error states.
5. **Tests:** every ID for this milestone has a test named `[ID] ...` (`cms-testing`).
6. **Verify** (`cms-verify`): typecheck, lint, all tests, Playwright, a 360 px check of new screens, and a PRD check of the change; `cms-security-review` when auth, routes, files, chat or AI changed.
7. **`/spec-check <spec number>`**. The milestone is done only when the spec is reported complete (or "complete for this milestone" for IDs the plan places later).
8. **Commit and push** after each topic (CLAUDE.md): one topic per commit, message covers everything, `git push`, confirm it succeeded.
9. **Report in chat:** what was built, the spec-check table, anything left for later milestones, and any PRD or spec problem found and fixed. If you find a problem in a spec or plan, fix the document in the same milestone (its own commit) unless it would contradict the PRD or a client decision; then ask.

## Rules
- `docs/PRD.md` wins over specs and plans; client decisions in `.claude/CLAUDE.md` are never reopened.
- Do not build features of a later milestone, except the early helpers the plan lists.
- Never claim a pass that was not run.
