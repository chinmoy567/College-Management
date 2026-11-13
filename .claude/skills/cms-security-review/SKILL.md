---
name: cms-security-review
description: Security review of a College Management System change - permissions, sessions, uploads, injection, data leaks, secrets. Use after changes to auth, API routes, files, chat or AI chat.
---

# Security review

Check the diff against `docs/PRD.md` §4.6 and §8:
1. Every route checks role AND assignment; test wrong role, wrong class, logged out (IDOR).
2. Input validated by shared Zod; no mass assignment; Prisma queries parameterised, no raw SQL with user text.
3. Responses return only needed fields (no password hashes, tokens, other users' data, correct exam answers early).
4. Sessions: hashed token, `httpOnly`/`Secure`/`SameSite=Lax`, checked on sockets too.
5. Uploads: real file type, size limit, private bucket, short-lived signed URLs after a permission check.
6. User text rendered safely (no XSS); AI chat keeps keys server-side and prompts cannot leak other users' data.
7. Rate limits on login, reset, upload, AI. No secrets in code, logs, or `NEXT_PUBLIC_*`.
8. Tell the user briefly in chat; do not write issue files into the repo. Do not reopen client decisions in `.claude/CLAUDE.md`.
