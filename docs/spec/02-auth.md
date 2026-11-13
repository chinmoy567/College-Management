# 02 · Authentication, Sessions & Profile

Source: PRD §2.2–2.4, §4.1–4.3, §4.6, `landing-page.md` §3. Skill: `cms-auth-permissions`.

## 1. Sessions

- Login creates a 32-byte random token (base64url). Cookie `cms_session` (`SESSION_COOKIE_NAME`): `httpOnly; Secure; SameSite=Lax; Path=/`; DB stores `sha256(token)` only.
- Lifetime: 30 days sliding for teachers/students (refresh `expiresAt` and `lastSeenAt` at most once per 10 min); **Admin 12 hours, not sliding**.
- Every request: lookup by hash → reject if `revokedAt`, `expiresAt < now`, or `user.status != active` (then clear the cookie, 401 `SESSION_ENDED`). Status check also blocks muted users from writing (06 §6), not from reading.
- **Revoke all sessions of a user** (`revokeAllSessions(userId, exceptSessionId?)`) on: password change/reset, email change, deactivate, pass-out, anonymise, Admin password reset. Also emits `session:revoked` to that user's sockets and disconnects them (07 §1).
- CSRF: `SameSite=Lax` + every state-changing request must carry header `X-Requested-With: cms` (the API client always sends it; forms cannot). Reject otherwise.
- Socket.IO handshake reuses the same cookie (same origin) and the same lookup.

## 2. Login

`POST /api/auth/login` `{ identifier, password, roleHint? }`

1. Rate limit (§6). Normalise identifier: trim; if it contains `@`, lower-case and match `email`, else match `loginId` (case-insensitive).
2. Unknown user, wrong password, or `status = deleted` → **same** response `401 INVALID_CREDENTIALS` "Wrong ID or password." Run argon2 verify against a dummy hash for unknown users (equal timing).
3. `status = inactive` → `403 ACCOUNT_INACTIVE` "Your account is inactive. Contact the college office."
   `status = passed_out` → `403 ACCOUNT_PASSED_OUT` "Your account is inactive because your session has been completed." (PRD §4.5). Only shown after the correct password.
4. Write `LoginHistory`.
5. **Admin:** create session with `stepUpPending = true` → `200 { next: "totp" }` (or `{ next: "totp_setup" }` if TOTP not enabled). A step-up session can call only the TOTP routes.
6. Others: create session → `200 { next: firstLogin ? "complete_profile" : "dashboard", role, roleMismatch: roleHint && roleHint != role }`. The UI shows "This is a Teacher account" style notice on mismatch but still goes to the real dashboard (`landing-page.md` §3.2).

`POST /api/auth/logout` – revoke current session, clear cookie.
`GET /api/auth/me` – `{ user: { id, role, name, avatarUrl, firstLogin, emailVerified, isMentorOf?: sectionId, mutedUntil? } }`.

## 3. Admin two-step (TOTP)

| Route | Purpose |
|---|---|
| `POST /api/auth/totp/setup` | Step-up session, TOTP not enabled. Generates secret (otplib, 30 s, 6 digits), stores encrypted (pending), returns `otpauth://` URI + QR data URL. |
| `POST /api/auth/totp/enable` `{ code }` | Verifies code, sets `totpEnabledAt`, generates **10 backup codes** (10 chars, `xxxxx-xxxxx`), stores argon2 hashes, returns codes **once**. |
| `POST /api/auth/login/totp` `{ code }` or `{ backupCode }` | Verify (window ±1 step). Backup code is removed after use. Success clears `stepUpPending`. 5 wrong codes → session revoked, must log in again. |
| `POST /api/auth/totp/backup-codes/regenerate` `{ password, code }` | Replaces all 10. |

- First Admin login order: password → forced new password (seed password must change) → TOTP setup → dashboard.
- Secret encryption: AES-256-GCM with `TOTP_ENC_KEY` (32 bytes, base64, env only).
- Replay protection: remember the last accepted time-step per Admin; reject the same step twice.

## 4. First login (teacher & student) — PRD §4.2

`POST /api/me/complete-profile` `{ newPassword, mobile }` (only while `firstLogin = true`)
- Password policy: min 8 chars, not equal to the initial password, not the login ID, checked against a small common-password list.
- Mobile: Bangladesh format `^01[3-9]\d{8}$` (stored as entered, normalised to `01XXXXXXXXX`).
- Sets `firstLogin=false`, `mustChangePassword=false`, revokes other sessions, queues verification email to the Admin-entered email (priority `high`, 07 §6).
- Dashboard is unlocked; `emailVerified=false` shows a banner (not a block).

## 5. Password & email

| Route | Rules |
|---|---|
| `POST /api/auth/password/forgot` `{ email }` | Always `200` with the same message. If a user with a **verified** email exists and is active: create `Token(password_reset)` valid **20 min**, queue email (priority high). Unverified → nothing sent (UI text says: "If the email is registered and verified, a link was sent. Otherwise ask the Admin."). Admin reset still needs TOTP afterwards. |
| `POST /api/auth/password/reset` `{ token, newPassword }` | Single-use, not expired (`410 TOKEN_EXPIRED`). Sets password, marks token used, revokes all sessions. |
| `POST /api/me/password` `{ currentPassword, newPassword }` | Revokes other sessions. |
| `POST /api/me/email` `{ newEmail, password }` | Unique check; `Token(email_change, newEmail)` 30 min, link sent to the **new** email. |
| `GET /api/auth/email/verify?token=` | `email_verify` sets `emailVerifiedAt`; `email_change` swaps email, sets verified, revokes other sessions. Redirects to `/profile?verified=1`. |
| `POST /api/me/email/resend-verification` | Max 3 per day. |

- Tokens: 32 random bytes, only sha256 stored. Links: `${APP_URL}/reset-password?token=...`.
- When SMTP fails (Render may block SMTP), the mail worker logs the link at `warn` level so the demo still works (tech.stack §7). Never in production mode if `LOG_EMAIL_LINKS=false`.

## 6. Rate limits (PostgreSQL store, `RateLimitHit`)

| Key | Limit |
|---|---|
| login per IP | 20 / 15 min |
| login per identifier | 5 failures / 15 min → `429` "Too many attempts, try again in N minutes" |
| TOTP per session | 5 attempts |
| forgot password per IP / per email | 5 / hour, 3 / hour |
| messaging send per user | 30 / min (07) |
| AI chat per user | 6 / min + daily limit (09) |
| uploads per user | 60 / hour |
| reports per user | 20 / day |

Old `RateLimitHit` rows are purged nightly.

## 7. Profile (`/api/me`)

`GET /api/me/profile`, `PATCH /api/me/profile`

| Field | Student edit | Teacher edit |
|---|---|---|
| avatar (upload, 5 MB image) | ✅ | ✅ |
| name | ✅ unless `nameLocked` | ✅ |
| mobile | ✅ | ✅ |
| bio | ✅ | ✅ |
| dob | ✅ (PRD §2.4 "keep DOB up to date") | – |
| address, guardianName, guardianContact | ✅ | – |
| loginId, session/group/section/class, roll | read-only | read-only |
| designation, subjects | – | read-only (Admin sets) |

No age rule is applied anywhere (client decision); `age` can be computed from `dob` for display.

## 8. Acceptance

- **AUTH-01** Unknown ID and wrong password return the same error with similar timing.
- **AUTH-02** Passed-out and inactive users cannot log in; their specific message appears only after a correct password.
- **AUTH-03** Deactivating a user makes their existing session get 401 on the next request and disconnects their socket.
- **AUTH-04** A first-login user can call only auth routes and complete-profile.
- **AUTH-05** The Admin reaches no Admin API before TOTP; a backup code works once; the same TOTP time-step is rejected twice; 5 wrong codes revoke the session.
- **AUTH-06** Reset tokens that are expired, reused or for the wrong purpose fail; a reset revokes all sessions.
- **AUTH-07** An unverified email receives no reset email, and the response is the same as for a verified one.
- **AUTH-08** A state-changing request without `X-Requested-With: cms` gets 403.
- **AUTH-09** 5 failed logins for one identifier in 15 minutes give 429.
- **AUTH-10** Complete-profile enforces the password policy and Bangladesh mobile format, sends the verification email, and unlocks the dashboard with a "verify your email" banner.
- **AUTH-11** Email change sends the link to the new email; verifying swaps the email and revokes other sessions.
- **AUTH-12** Session cookie is `httpOnly; Secure; SameSite=Lax`; only the token hash is in the database.
- **AUTH-13** Profile: a student cannot change a locked name or any read-only field; teachers cannot edit designation or subjects.
- **AUTH-14** (UI) Login form at 360 px: role buttons pre-select the label, role mismatch shows the notice and still lands on the real dashboard, Admin gets the code step, first login goes to Complete Your Profile.
