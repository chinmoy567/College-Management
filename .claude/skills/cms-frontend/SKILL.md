---
name: cms-frontend
description: Build or change College Management System UI in apps/web (Next.js App Router, Tailwind, shadcn/ui, TanStack Query, Motion). Use for any page, component, form, layout or animation. Phone-first.
---

# CMS frontend

Read the `docs/PRD.md` section for the feature and `docs/tech.stack.md` §2 first. Never reopen `.claude/CLAUDE.md` decisions.

## Structure
- Code in `apps/web`. Zod schemas and shared types come from `packages/shared`; never duplicate them.
- Server data via TanStack Query calling the Express API (`/api/...`, same origin, cookie auth). No direct DB, no `supabase-js`, no secrets in the browser.
- Forms: React Hook Form + shared Zod schema. Show server validation errors per field.
- Role-based UI: hide controls the role can't use, but the API is the real guard.

## Mobile-first checklist (95% of users are on phones)
- Design at 360 px; add `sm:`/`md:`/`lg:` only to enlarge. No horizontal page scroll.
- Touch targets >= 44x44 px, body/input text >= 16 px, correct `type`/`inputmode`.
- Navigation = bottom tab bar or drawer. Dialogs = full-screen sheets on phones.
- Tables become stacked cards (attendance, students, results). Routine = day-by-day list.
- Chat, exam, attendance marking and the PDF reader work one-handed.
- Lazy-load react-pdf and Recharts; check size before adding any library.

## Motion
150-300 ms, transform/opacity only, honour `prefers-reduced-motion`, none on the exam page or heavy lists.

## Dates
Stored UTC; display Asia/Dhaka with date-fns-tz.

## States
Every screen has loading, empty and error states. Use sonner toasts for results.

## Done when
Type-check and lint pass and the screen was checked at phone width. Say what you verified and what you could not.
