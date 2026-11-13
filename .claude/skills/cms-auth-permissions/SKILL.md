---
name: cms-auth-permissions
description: Implement or review login, sessions, TOTP, password flows, role and assignment checks for the College Management System. Use for anything touching auth, roles or access control.
---

# CMS auth and permissions

Source: `PRD.md` §2.1 permission matrix, §3.3-3.4 assignments, §4 auth, §4.6 security.

## Sessions
- Own `LoginSession` table. Random token in an `httpOnly`, `Secure`, `SameSite=Lax` cookie; store only its hash. Check on every request and every Socket.IO connect.
- Passwords: argon2. Admin second step: otplib TOTP + hashed backup codes. One Admin account only (by design).
- Admin-issued login IDs; forced password change on first login; revoke sessions on password/email change, deactivation and pass-out.
- Rate-limit login, reset and TOTP attempts; generic error messages (no user enumeration).

## Authorization = role + assignment
A role alone is never enough. A Teacher acts only on courses/sections assigned to them; a Section Mentor only on their section; a Student only on their own data and enrolled courses. Write one reusable helper per check and unit-test allowed and denied cases.

## Review checklist
- IDOR (user-supplied ids), mass assignment (whitelist fields via Zod).
- Missing check on a websocket event or room join.
- Signed URL issued without a permission check.
- Inactive or passed-out users still able to act.

Students may be minors: no extra age rules (client decision); just protect their data.
