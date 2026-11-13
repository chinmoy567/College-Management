# Plan 02 · Authentication, Sessions & Profile (Milestone M2)

Spec: `docs/spec/02-auth.md` · PRD §2.2–2.4, §4.1–4.3, §4.6. Agent: `auth-security`. Skill: `cms-auth-permissions`.
Goal: every request knows exactly who the actor is, and no one gets further than they should.

## 1. Build order

1. **Crypto helpers** (`lib/crypto.ts`): `randomToken(32)` base64url, `sha256`, argon2id hash/verify (memory 19 MiB, t=2 — OWASP baseline; keeps login fast on the free CPU), AES-256-GCM `encrypt/decrypt` for the TOTP secret with `TOTP_ENC_KEY`.
2. **Session store** (`modules/auth/sessions.ts`): `createSession(user, { stepUpPending })`, `lookup(tokenHash)`, `touch()` (sliding, at most once per 10 min, not for Admin), `revoke(id)`, `revokeAllSessions(userId, exceptId?)`.
3. **Middleware chain** (`middleware/session.ts`, order matters):
   `csrfGuard` (state-changing methods need `X-Requested-With: cms`, AUTH-08) → `sessionMiddleware` (cookie → hash → session + user, status checks, sets `req.actor`, clears cookie on 401 `SESSION_ENDED`) → `firstLoginGate` (`FIRST_LOGIN_REQUIRED`) → `stepUpGate` (Admin with `stepUpPending` or no TOTP may call only TOTP routes) → `requireRole(...)`.
   Public routes are mounted **before** the chain on a separate router so they can never accidentally require auth (or skip it).
4. **Rate limiter** (`middleware/rateLimit.ts`): custom `express-rate-limit` store on `RateLimitHit` (insert + count in window, one SQL round-trip). Keys from spec §6. Login per-identifier counts **failures only** (increment after verify fails).
5. **Login** route + `LoginHistory`; equal-timing path: always run `argon2.verify` (dummy hash for unknown user) before deciding (AUTH-01). Status messages only after a correct password (AUTH-02).
6. **TOTP** (otplib authenticator, step 30 s, window ±1): setup → enable → backup codes (10 × `xxxxx-xxxxx`, argon2 hashed) → login/totp with replay guard (`User.totpLastStep`) and 5-strike session revoke (counter on the session row). Regenerate codes needs password + code.
7. **First Admin login order:** password → forced new password → TOTP setup → dashboard. Implemented as `next` states returned by the API (`change_password`, `totp_setup`, `totp`), so the UI is a dumb state machine.
8. **First login (teacher/student)**: `POST /api/me/complete-profile` with password policy (min 8, not initial, not login ID, top-10k common list shipped as a gzipped text file loaded once) + BD mobile regex; revokes other sessions; queues verification email.
9. **Tokens & email flows**: `Token` table (sha256 only), forgot (always same 200; only verified + active → mail), reset (single use, 20 min, `410 TOKEN_EXPIRED`, revoke all), change email (link to **new** address), verify (`email_verify` / `email_change`), resend (3/day).
10. **Email queue (early part of 07 §5):** `email.send` pg-boss job with priority high/normal and the `EmailQuota` conditional update; SMTP failure → log the link at `warn` only if `LOG_EMAIL_LINKS=true`. Templates in `modules/mail/templates/`.
11. **Socket.IO auth (early part of 07 §1):** handshake reads the cookie, same `lookup`; reject first-login / step-up / inactive; join `user:<id>`; store `loginSessionId` on the socket; `revokeAllSessions` emits `session:revoked` and disconnects those sockets (AUTH-03). 5-minute revalidation timer.
12. **Profile** (`/api/me/profile`): field-level edit matrix from spec §7 implemented as **two Zod schemas** (`studentProfileUpdate`, `teacherProfileUpdate`) — read-only fields simply do not exist in the schema, so they are stripped (AUTH-13). `nameLocked` checked in the service. Avatar upload uses the image pipeline (`lib/storage.ts`, images only for now).
13. **`audit()`** helper (needed for Admin actions here and in M3).
14. **Screens** (with M4 shell or right here): `/login?role=`, Admin TOTP step + setup + backup codes view, `/complete-profile`, forgot/reset/verify pages, `/profile`, "verify your email" banner.

## 2. Security notes

- Cookie: `httpOnly; Secure; SameSite=Lax; Path=/`. In local dev over http, `Secure` is off only when `NODE_ENV=development` (asserted in a test so production can never ship without it, AUTH-12).
- Never return whether an email exists (forgot password).
- `GET /api/auth/me` returns `isMentorOf` and `mutedUntil` so the UI can hide controls; the API still checks.
- Timing test for AUTH-01 uses a tolerance (e.g. unknown vs wrong password median within 30%) over 10 runs to avoid flakiness.
- `revokeAllSessions` is the single choke point; every lifecycle action (03) calls it — grep test ensures no direct `loginSession.update({revokedAt})` elsewhere.

## 3. Acceptance → tests

| ID | Test |
|---|---|
| AUTH-01 | `[AUTH-01] unknown id and wrong password same error, similar timing` |
| AUTH-02 | `[AUTH-02] passed-out / inactive blocked, message only after correct password` |
| AUTH-03 | `[AUTH-03] deactivate → 401 next request and socket disconnected` (socket.io-client in test) |
| AUTH-04 | `[AUTH-04] first-login user limited to auth + complete-profile` |
| AUTH-05 | `[AUTH-05] admin blocked before TOTP; backup code once; step replay rejected; 5 wrong codes revoke` (otplib with mocked time) |
| AUTH-06 | `[AUTH-06] reset token expired/reused/wrong purpose fails; reset revokes all` |
| AUTH-07 | `[AUTH-07] unverified email gets no mail, same response` (assert email queue empty) |
| AUTH-08 | `[AUTH-08] write without X-Requested-With → 403` |
| AUTH-09 | `[AUTH-09] 5 failures per identifier in 15 min → 429` |
| AUTH-10 | `[AUTH-10] complete-profile policy, BD mobile, verification queued, banner flag` |
| AUTH-11 | `[AUTH-11] email change link to new address, verify swaps + revokes others` |
| AUTH-12 | `[AUTH-12] cookie flags; only hash in DB` |
| AUTH-13 | `[AUTH-13] read-only/locked fields cannot change` |
| AUTH-14 | Playwright `[AUTH-14] login form at 360 px …` (needs M4 shell; run at end of M4) |

## 4. Definition of done (M2)

All AUTH IDs except AUTH-14 green at M2; AUTH-14 green at M4. "Deactivation kills sessions" proven by AUTH-03. Run `cms-security-review` on the diff, then `/spec-check 02`.
