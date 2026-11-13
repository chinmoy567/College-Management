# College Management System

- Source of truth for requirements: `PRD.md`. Do not build features that contradict it or are listed as out of scope.
- After any meaningful change (PRD edits, schema/migrations, auth/permissions, API routes, exams, attendance, chat, file storage, AI chat) and before committing, run the `system-architect` subagent and show the user its findings.
- The architect keeps its issue history in `.claude/architect/REVIEW_LOG.md` and must update it on every review; check that the log changed before committing.
- Commits: one topic per commit, and the message must describe everything the commit does (including any file deletions).
- **After every commit, push it immediately** (`git push`) and confirm the push succeeded.

