# Demo data (development only)

All scripts are idempotent (fixed ids, safe to re-run) and refuse to run when `NODE_ENV=production`.

## Order (first-time setup)
1. `npm run db:migrate`, `npm run db:seed`, `npm run db:seed:demo` (Admin, settings, periods, rooms, demo sections and students)
2. `npx tsx prisma/seed-teachers.ts`, `seed-offerings.ts`, `seed-courses-full.ts`, `seed-students-90.ts` (teachers, courses, offerings, students; logins are printed or in `docs/system-password.md`)
3. `npm run db:seed:all` runs the rest in order:

| Command | Adds |
|---|---|
| `db:seed:routine` | Routine and the next 14 days of class meetings |
| `db:seed:attendance` | 6 weeks of held meetings and attendance |
| `db:seed:exams` | Question bank, 6 exams per demo offering (6 offerings), attempts |
| `db:seed:people` | Section Mentors for sections without one, holidays, special day, profile details |
| `db:seed:community` | Feed posts, pinned posts, comments, reactions, reports, one warning |
| `db:seed:notices` | Central and class notices, read marks, notifications, notification preferences |
| `db:seed:chat` | Section, group and direct chats with messages and unread counts |
| `db:seed:learning` | Online classes, recorded classes, notes (links) per offering |
| `db:seed:ai` | Saved AI study conversations and usage (canned answers) |
| `db:seed:exam-extras` | Answer-key fixes, cancelled questions, extra-time extensions on demo exams |

## Not seeded
- Book Shop (a book needs real PDF and cover files in Supabase Storage).
- Previous-year questions and uploaded note files (they need real files).
- Post images, chat attachments, avatars.
