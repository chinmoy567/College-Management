# College Management System

- Source of truth for requirements: `docs/PRD.md`. Do not build features that contradict it or are listed as out of scope.

## Client decisions: never reopen or report as issues
- Students are up to 18 years old and may be minors (client). Age comes from the profile DOB. Groq (not Gemini) is the AI provider because its terms allow minors. No extra age-based rules.
- Groq is the AI provider. Gemini is not used.
- The Admin decides everything about enrollment and schedule: rooms, periods, routine, holidays, cancelled or re-created meetings, conflicts.
- One Admin account only, by design.
- Exam scoring: right = marks, wrong = 0, no negative or partial marks.
- Git, commits and `.gitignore` are handled by the developer; do not raise them as issues.

## Review of changes
- There is no architect agent and no review log. After a meaningful change (PRD edits, schema/migrations, auth/permissions, API routes, exams, attendance, chat, file storage, AI chat), check it yourself against `docs/PRD.md` for contradictions, gaps and security/data-integrity problems, and tell the user briefly in chat.
- Do not write issue lists or detail files into the repo.

## Specs and testing
- Build from `docs/spec/` in the milestone order in `docs/spec/README.md`.
- Every Acceptance ID in a spec needs a test named `[ID] ...` (see `docs/spec/00-conventions.md` §9).
- After finishing a milestone or spec, automatically run `/spec-check <spec number>` (skill `spec-check`, agent `spec-verifier`). A milestone is done only when that check reports the spec complete.

## Documents
- All project documents live in the `docs/` folder (`docs/PRD.md`, `docs/tech.stack.md`, `docs/dashboards.md`, and any new document). Do not put documents in the repo root.

## Commits
- The user does not commit or push. Claude commits and pushes after every change that touches the repo, without being asked.
- One topic per commit; the message must describe everything the commit does (including any file deletions).
- **After every commit, push it immediately** (`git push`) and confirm the push succeeded.
