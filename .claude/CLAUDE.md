# College Management System

- Source of truth for requirements: `docs/PRD.md`. Do not build features that contradict it or are listed as out of scope.

## Client decisions: never reopen or report as issues
- Students are up to 18 years old and may be minors (client). Age comes from the profile DOB. Groq (not Gemini) is the AI provider because its terms allow minors. No extra age-based rules.
- Groq is the AI provider. Gemini is not used.
- The Admin decides everything about enrollment and schedule: rooms, periods, routine, holidays, cancelled or re-created meetings, conflicts.
- One Admin account only, by design.
- Exam scoring: right = marks, wrong = 0, no negative or partial marks.
- `.gitignore` is handled by the developer; do not raise it as an issue. Commits and pushes are Claude's job (see "Commits").

## Review of changes
- There is no architect agent and no review log. After a meaningful change (PRD edits, schema/migrations, auth/permissions, API routes, exams, attendance, chat, file storage, AI chat), check it against `docs/PRD.md` for contradictions, gaps and security/data-integrity problems (yourself, or with the read-only `prd-checker` agent), and tell the user briefly in chat.
- Do not write issue lists or detail files into the repo.

## Specs and testing
- Build from `docs/spec/` in the milestone order in `docs/spec/README.md`, following each spec's plan in `docs/implementation/` (run a milestone with `/milestone <M#>`). Architecture diagrams: `docs/architecture.md`.
- Every Acceptance ID in a spec needs a test named `[ID] ...` (see `docs/spec/00-conventions.md` §9).
- After finishing a milestone or spec, automatically run `/spec-check <spec number>` (skill `spec-check`, agent `spec-verifier`). A milestone is done only when that check reports the spec complete.

## Documents
- All project documents live in the `docs/` folder (`docs/PRD.md`, `docs/tech.stack.md`, and any new document). Do not put documents in the repo root.

## Commits (mandatory, no exceptions)
- The user does not commit or push. Claude does, without being asked.
- **Commit and push after EVERY task, however small**: each bug fix, each edit to a doc/spec/config, each new file, each test added, each finished step of a plan. Do not batch several tasks into one commit and do not wait for the end of a milestone or session.
- **Never end a turn with uncommitted or unpushed changes.** Before your final reply, run `git status` and `git log @{u}..`; if anything is uncommitted or unpushed, commit and push it first.
- Workflow per task: finish the task, verify it, `git add` only the files of that task, `git commit`, then `git push` immediately and confirm it succeeded. If the push fails, fix it and report it; never leave it.
- One topic per commit; the message must describe everything the commit does (including any file deletions).
- Files left uncommitted by an earlier task or session are also your job: commit them (grouped by topic) and push.
