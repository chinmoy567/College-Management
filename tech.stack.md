# Tech Stack: College Management System

The stack for building `PRD.md`. It is kept simple on purpose: **one repo, two Node apps (Next.js + Express), one PostgreSQL database on Supabase.**
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
Browser ──HTTPS──> Caddy (one domain, e.g. cms.college.edu)
                    ├── /        → Next.js   (web, port 3000)
                    ├── /api     → Express   (api, port 4000)
                    └── /socket.io → Express (Socket.IO)
Express ──> Supabase PostgreSQL   (data, sessions, jobs)
Express ──> Supabase Storage      (files, signed URLs)
Express ──> Gmail SMTP · Groq API
```

Next.js and Express sit behind **one domain**, so the login cookie is a normal first-party `httpOnly` cookie (no CORS or cross-site cookie problems).

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

Rules:
- Next.js **never talks to the database or Supabase directly.** It only calls the Express API.
- Do **not** use `supabase-js` in the browser.

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

## 7. Hosting & deployment

| Part | Where |
|---|---|
| Next.js + Express | One VPS (about 2 vCPU / 4 GB RAM) with **Docker Compose** |
| HTTPS + routing | **Caddy** (automatic HTTPS, routes `/api` and `/socket.io` to Express) |
| Database + files | Supabase |
| Backups | Supabase daily backups **plus** a nightly `pg_dump` job on the VPS kept **30 days** (PRD §8 asks for 30) |

Supabase plan: the **free plan** is fine for development but pauses idle projects and has small database and storage limits (book PDFs up to 100 MB will fill it). Use the **Pro plan** for production.

## 8. Repo layout

```
/apps
  /web        Next.js (frontend)
  /api        Express (backend, Socket.IO, jobs)
/packages
  /shared     Zod schemas, shared types and constants
/prisma       schema.prisma + migrations (used by /apps/api)
docker-compose.yml
Caddyfile
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
APP_URL=https://cms.college.edu
TZ_DISPLAY=Asia/Dhaka

# web
NEXT_PUBLIC_APP_URL=https://cms.college.edu
```
