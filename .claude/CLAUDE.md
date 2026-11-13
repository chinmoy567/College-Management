# College Management System

- Source of truth for requirements: `PRD.md`. Do not build features that contradict it or are listed as out of scope.

## Client decisions: never reopen or report as issues
- Students are up to 18 years old and may be minors (client, v2.17). Age comes from the profile DOB. Groq (not Gemini) is the AI provider because its terms allow minors. No extra age-based rules.
- Groq is the AI provider. Gemini is not used.
- The Admin decides everything about enrollment and schedule: rooms, periods, routine, holidays, cancelled or re-created meetings, conflicts.
- One Admin account only, by design.
- Exam scoring: right = marks, wrong = 0, no negative or partial marks.
- Git, commits and `.gitignore` are handled by the developer; do not raise them as issues.

## Review of changes
- There is no architect agent and no review log. After a meaningful change (PRD edits, schema/migrations, auth/permissions, API routes, exams, attendance, chat, file storage, AI chat), check it yourself against `PRD.md` for contradictions, gaps and security/data-integrity problems, and tell the user briefly in chat.
- Do not write issue lists or detail files into the repo.

## Commits
- One topic per commit; the message must describe everything the commit does (including any file deletions).
- **After every commit, push it immediately** (`git push`) and confirm the push succeeded.
