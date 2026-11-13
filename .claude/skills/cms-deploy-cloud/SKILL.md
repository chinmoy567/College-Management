---
name: cms-deploy-cloud
description: Deploy the College Management System to the free cloud (Render + Supabase), set env vars, run migrations, set up the keep-alive monitor and test the live site. Use when putting the website online.
---

# Deploy to the cloud

Follow `docs/tech.stack.md` §7. Free tiers only; ask before creating anything paid.

1. Confirm `render.yaml`, `.env.example` and the build/start commands are correct and the app builds locally.
2. Supabase: project in Mumbai/Singapore, RLS on every table with no policies, private and public buckets, `DATABASE_URL` (session pooler 5432) and `DIRECT_URL`.
3. Render: one web service from the GitHub repo, `main` auto-deploys, env vars set in the dashboard only (never committed, never `NEXT_PUBLIC_` for secrets).
4. Run `prisma migrate deploy`; take a `pg_dump` first when the migration is risky.
5. Add a free monitor (UptimeRobot or cron-job.org) calling `GET /api/health` every 10 minutes.
6. Test the live URL: health, login, one flow per role, a file upload, chat connect. Check at 360 px.
7. Tell the user the known limits: sleep after 15 minutes without the monitor, SMTP may be blocked, 50 MB files, Supabase pause after 7 days idle.
