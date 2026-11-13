# Tech Stack: College Management System

The stack for building `PRD.md`. It is kept simple on purpose: **one repo, Next.js + Express running together as one Node service, one PostgreSQL database on Supabase. Hosting costs nothing (Section 7).**
Language everywhere: **TypeScript**.

## 1. Overview

| Layer | Choice | Why |
|---|---|---|
| **Frontend** | **Next.js** (App Router) + **Tailwind CSS** | Pages and UI only. Mobile-first, PWA. |
| **Backend API** | **Express.js** + **Socket.IO** | All business rules, REST API, real-time chat and notifications, background jobs. |
| **Database** | **PostgreSQL**, hosted on **Supabase** | One database for all data, sessions, rate limits and the job queue. No Redis. |
| **File storage** | **Supabase Storage** (private buckets) | Images, PDFs and books, served by short-lived signed links. |
| **ORM** | **Prisma** | Typed queries; every schema change is a migration in the repo. |

```
Browser ──HTTPS──> one free web service (e.g.  cms-demo.onrender.com)
                    Express (one Node process)
                    ├── /api, /socket.io → Express routes + Socket.IO
                    └── everything else  → Next.js (rendered inside the same process)
Express ──> Supabase PostgreSQL   (data, sessions, jobs)
Express ──> Supabase Storage      (files, signed URLs)
Express ──> Gmail SMTP · Groq API
```

Express is the server and hands every non-API request to Next.js (`next({ dev }).getRequestHandler()`). So the site has **one address**: the login cookie is a normal first-party `httpOnly` cookie, Socket.IO works, and there are no CORS or cross-site cookie problems. The code stays split into `/apps/web` and `/apps/api`.

## 2. Frontend: Next.js

| Need | Library |
|---|---|
| Framework | Next.js (App Router), React, TypeScript |
| Styling | **Tailwind CSS** |
| UI components | shadcn/ui (copy-in components built on Radix; accessible forms, dialogs, tables) |
| Server data | TanStack Query (fetch, cache, refetch from the Express API) |
| Forms + validation | React Hook Form + Zod (same Zod schemas as the API) |
| Real-time | socket.io-client |
| PDF reader | react-pdf (PDF.js) |
| Charts | Recharts |
| Dates | date-fns + date-fns-tz (show everything in **Asia/Dhaka**) |
| PWA | Web app manifest + a small service worker ("add to home screen") |
| Animation | **Motion** (formerly Framer Motion) for page, sheet and list transitions; `tailwindcss-animate` and plain CSS transitions for small effects |
| Icons | lucide-react |
| Other UI helpers | Any small, well-maintained CSS/UI library the team needs (e.g. `sonner` toasts, `vaul` bottom sheets, `embla-carousel`), as long as it is free, works well on phones and is added to the repo as a normal dependency |

Rules:
- Next.js **never talks to the database or Supabase directly.** It only calls the Express API.
- Do **not** use `supabase-js` in the browser.

**Mobile first (about 95% of users are on phones):** design every screen for a phone first, then enlarge for tablet and desktop.
- Write Tailwind classes for the small screen first and add `sm:` / `md:` / `lg:` only to enlarge. Design for a 360 px wide screen; no horizontal page scroll.
- Touch targets at least 44×44 px; body text at least 16 px (smaller text makes iOS zoom into inputs).
- Navigation is a bottom tab bar or drawer on phones, not a wide top menu. Dialogs become full-screen sheets on phones.
- Tables turn into stacked cards on phones (attendance, student lists, results, routine). The routine is a day-by-day list, not a wide grid.
- Use the right keyboard (`inputmode`, `type="tel"`, `type="email"`) and keep forms short, one column.
- Chat, exam taking, attendance marking and the PDF reader must work one-handed on a phone. The exam timer stays visible.
- Keep pages light for slow mobile data: lazy-load images and heavy libraries (react-pdf, Recharts), resize images on upload (sharp).
- Test every feature at phone width before it is done.
- **Animation is welcome but light:** use short (about 150-300 ms) transforms and opacity only, respect `prefers-reduced-motion`, and never animate inside the exam page or long lists in a way that slows low-end phones. Check the size of any new library before adding it.

## 3. Backend: Express.js

| Need | Library |
|---|---|
| HTTP server | Express, TypeScript |
| Real-time | Socket.IO (single server, no Redis adapter) |
| Database | Prisma Client |
| Validation | Zod (shared with the frontend) |
| Passwords | argon2 |
| Login sessions | Own `LoginSession` table (PRD §4.6): random token in an `httpOnly`, `Secure`, `SameSite=Lax` cookie, only its hash stored. Checked on every request and when a socket connects. |
| Admin two-step login | otplib (TOTP) + hashed backup codes |
| Rate limiting | express-rate-limit with a small PostgreSQL store |
| Background jobs | **pg-boss** (exam auto-submit, email queue, Class Meeting generation, scheduled notices, pin expiry) |
| Email | Nodemailer → Gmail SMTP (rate-limited by the job queue) |
| File uploads | multer (memory) + file-type (check real type) + sharp (resize images) |
| Book preview | pdf-lib (cut preview pages into a separate PDF) |
| AI | groq-sdk (server-side only) |
| Security headers | helmet |
| Logs | pino (to files / stdout) |

API layout: `/api/<module>/...`, one folder per module (auth, users, academics, schedule, attendance, feed, chat, notices, notifications, classes, materials, exams, books, ai, admin). Every route checks **role + assignment** (PRD §4.6).

## 4. Database: PostgreSQL on Supabase

- **Supabase is used only for hosted PostgreSQL and Storage.** We do **not** use Supabase Auth, Realtime or the auto-generated REST API, because the PRD needs admin-issued login IDs, server-side sessions and Socket.IO.
- **Lock the Supabase REST API:** turn on Row Level Security on every table with **no policies**, so the public `anon` key can read nothing. Express connects with the database password and is not affected.
- The `service_role` key and database password live **only** in the Express `.env`, never in Next.js.
- **Region:** Mumbai (`ap-south-1`) or Singapore, the closest to Dhaka.
- **Connection strings:**
  - `DATABASE_URL`: Supabase **session pooler** (port 5432); used by Express, Prisma and pg-boss (pg-boss needs session mode, not transaction mode).
  - `DIRECT_URL`: direct connection, used only by `prisma migrate`.
- Times stored in **UTC** (`timestamptz`), shown in Asia/Dhaka.

## 5. File Storage: Supabase Storage

| Bucket | Access | Holds |
|---|---|---|
| `public` | Public | College logo/banner, landing-page notice files, book covers |
| `private` | Private | Post/comment images, avatars, chat files, notes, previous questions, book PDFs and previews |

- Express uploads files with the `service_role` key after checking type and size (PRD §8).
- Students get private files only through **signed URLs that expire in a few minutes**, created by Express after a permission check.

## 6. External services

| Service | Use |
|---|---|
| Gmail SMTP (free account, app password) | Auth emails, notice emails (queued, daily limit in Settings) |
| Groq API (free tier) | AI study assistant; model name in Settings |
| Google Meet / Jitsi | Live class links pasted by teachers (no integration) |
| YouTube | Recorded class links (embedded player) |

## 7. Hosting & deployment (free, no domain needed)

| Part | Where | Cost |
|---|---|---|
| Next.js + Express (one service) | **Render**, free web service | Free, no credit card |
| Database + files | **Supabase**, free plan | Free, no credit card |
| Address | Free Render subdomain, e.g. `https://cms-demo.onrender.com` (HTTPS included) | Free, no domain to buy |
| Email | Gmail SMTP (free account) | Free |
| AI | Groq free tier | Free |
| Code | GitHub; Render deploys on every push to `main` | Free |

**Free-plan limits (check them at sign-up; free plans change):**
- **Render sleeps after about 15 minutes with no visitors.** The next visit takes about a minute to wake it. **Open the site a minute before showing the client.** Background jobs (emails, Class Meeting generation) wait until it wakes; exam deadlines are still enforced because the server checks `deadline_at` on every answer and submit.
- **Keep it awake (free):** Express has a `GET /api/health` route that runs `SELECT 1` on the database and returns `ok`. A free monitor (**UptimeRobot** or **cron-job.org**) calls it **every 10 minutes**, so Render never sleeps, background jobs keep running, and Supabase never sees 7 days without activity (no pause). Render's free plan gives **750 hours a month**, which covers **one** service running all month (a month has at most 744 hours), so keep the whole app as one service. If the monitor is down for a while, the site just sleeps and wakes again on the next visit.
- **Render may block outgoing email (SMTP) on free services.** If emails do not arrive, the demo still works: reset/verification links are written to the server log, and the Admin can reset passwords.
- **Supabase free:** about 500 MB database, 1 GB file storage, **50 MB max per file** (so book PDFs are limited to 50 MB, PRD §8), and the project **pauses after 7 days with no activity**; open it from the Supabase dashboard to resume. No downloadable backups on the free plan; run `pg_dump` from your own computer before big changes and keep the last 30 days.
- Plenty for a **client demo** and testing. For the real college (about 3,000 users), 1 GB of files will fill up and the sleep delay is not acceptable.

**Later, for the real launch (still free):** Oracle Cloud **Always Free** VM (always on, no sleep; needs a card only for identity checks, nothing is charged) running the same app with Docker, and Caddy for HTTPS on a free subdomain (e.g. DuckDNS). Files can stay on Supabase. If the client wants their own domain, only the domain itself costs money (about $10/year).

## 8. Repo layout

```
/apps
  /web        Next.js (frontend)
  /api        Express (backend, Socket.IO, jobs)
/packages
  /shared     Zod schemas, shared types and constants
/prisma       schema.prisma + migrations (used by /apps/api)
render.yaml          Render settings (build + start commands)
.env.example
```

npm workspaces; one `npm install` at the root.

## 9. Environment variables (`.env.example`)

```
# api
DATABASE_URL=            # Supabase session pooler
DIRECT_URL=              # Supabase direct connection (migrations)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SESSION_COOKIE_NAME=cms_session
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=               # Gmail app password
SMTP_FROM=
GROQ_API_KEY=
APP_URL=https://cms-demo.onrender.com
TZ_DISPLAY=Asia/Dhaka

# web
NEXT_PUBLIC_APP_URL=https://cms-demo.onrender.com
```
