---
name: cms-run-and-test
description: Start the College Management System locally (API + web + dev DB), log in as each seeded role and test flows in a real browser at phone width. Use to see a change working or to run end-to-end checks.
---

# Run and test the website

1. Check `.env` exists (copy from `.env.example`); never print secrets.
2. Install and prepare: `npm install`, `npx prisma migrate deploy`, seed the dev DB.
3. Start the single Node service (Express serving Next.js) and wait for `GET /api/health` to return `ok`.
4. Load the Chrome tools (skill `claude-in-chrome`), open a new tab, and set the window to 360x800.
5. Log in as each role from the seed data; walk the flow from the spec's Acceptance IDs.
6. Check: no horizontal scroll, 44 px targets, console errors, failed network requests. Screenshot any problem.
7. Do not trigger alert/confirm dialogs. Stop and ask the user after 2-3 failed browser attempts.
8. Run Playwright (`npx playwright test`) for the automated version of the same flows.
9. Report what you ran, what passed, what failed. Say plainly if you could not run something.
